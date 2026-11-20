"""Deterministic source polling. Model calls never drive the discovery schedule."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import json
import re
import subprocess
import time
from .watchlist import now_iso

def next_daily(now=None):
    now = now or datetime.now(ZoneInfo('Asia/Shanghai'))
    target = now.replace(hour=9, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target.timestamp()

class NodeCollector:
    def __init__(self, root, node):
        self.root, self.node = root, node
        self.anchors=json.loads((root/'content/source-anchors.json').read_text())

    def __call__(self, source, page):
        result = subprocess.run([str(self.node), str(self.root / 'scripts/agent-source-page.cjs')],
                                input=json.dumps(dict(source=source, page=page)), text=True,
                                capture_output=True, timeout=25, cwd=self.root, check=False)
        if len(result.stdout.encode()) > 2 * 1024 * 1024:
            raise RuntimeError('source_adapter_failed')
        try:value = json.loads(result.stdout)
        except ValueError:raise RuntimeError('source_adapter_failed') from None
        if value.get('error_code'):
            raise SourceFailure(value['error_code'],http_status=value.get('http_status'),business_code=value.get('business_code'),url=value.get('url'))
        if result.returncode:raise RuntimeError('source_adapter_failed')
        return value

class SourceFailure(RuntimeError):
    def __init__(self, code, *, http_status=None, business_code=None, url=None):
        super().__init__(code)
        self.code,self.http_status,self.business_code,self.url=code,http_status,business_code,url

class Scanner:
    def __init__(self, store, fetch_page, on_progress=None, anchors=None):
        self.store, self.fetch_page = store, fetch_page
        self.on_progress = on_progress
        self.anchors=anchors if anchors is not None else getattr(fetch_page,'anchors',[])

    def plan(self):
        active = self.store.get('watchlist', {})
        enabled = {s['uid'] for s in self.store.sources()}
        sources = []
        for source in self.store.sources():
            uid = source['uid']
            sources.append(dict(uid=uid, type='posts', id=uid))
            for sid in source['season_ids']:
                anchor=next((a['bvid'] for a in source.get('collection_anchors',[]) if a['season_id']==sid),None)
                if not anchor:anchor=next((a['bvid'] for a in self.anchors if a['uid']==uid and a['season_id']==sid),None)
                sources.append(dict(uid=uid,type='season',id=sid,**({'anchor_bvid':anchor} if anchor else {})))
        for link in active.get('watchlist', {}).get('video_links', []):
            if link['uid'] in enabled:
                m = re.fullmatch(r'https://www\.bilibili\.com/video/(BV[1-9A-HJ-NP-Za-km-z]{10})/(?:\?p=([1-9][0-9]{0,3}))?', link['url'])
                sources.append(dict(uid=link['uid'], type='view', id=m[1], part=int(m[2] or 1)))
        active_keys = {self.key(s) for s in sources}
        for cursor in self.store.cursors():
            source = cursor.get('source', {})
            # Only metadata verification tasks derived from a CURRENT source survive.
            # Historical source cursors remain stored but do not grant scheduling rights.
            if (source.get('uid') in enabled and source.get('type') == 'view'
                    and any(k in active_keys for k in source.get('origin_keys', []))):
                sources.append(source)
        return list({self.key(s): s for s in sources}.values())

    @staticmethod
    def key(source):
        base=':'.join((source['uid'], source['type'], source['id'], str(source.get('part', 1))))
        return base+':anchor:'+source['anchor_bvid'] if source.get('anchor_bvid') else base

    def run(self, max_requests=60):
        report = dict(checked=0, ok=0, failed=0, restricted=0, deferred=0, new=0, skipped_limit=0, checked_at=now_iso())
        # Round robin: one page per source before spending the next page's budget.
        work = self.plan()
        while work:
            source = work.pop(0)
            key = self.key(source)
            cursor = self.store.cursor(key)
            now = time.time()
            if cursor['next_retry_at'] > now:
                report['deferred'] += 1
                continue
            if report['checked'] >= max_requests:
                report['skipped_limit'] += 1 + len(work)
                break
            report['checked'] += 1
            if self.on_progress:
                self.on_progress()
            try:
                page = cursor['page']
                result = self.fetch_page(source, page)
                if not isinstance(result['items'], list) or type(result['reached_end']) is not bool or len(result['items']) > 100:
                    raise ValueError('invalid_source_page')
                if not re.fullmatch(r'https://api\.bilibili\.com/[^\s]*', result['url']):
                    raise ValueError('invalid_source_url')
                if source.get('anchor_bvid'):
                    proof=result.get('collection',{})
                    if any(proof.get(k)!=v for k,v in dict(id=source['id'],uid=source['uid'],anchor_bvid=source['anchor_bvid']).items()):
                        raise ValueError('missing_collection_evidence')
                    total=proof.get('reported_total')
                    if (type(total) is not int or not 0<total<=10000 or proof.get('read_count')!=total
                            or not re.fullmatch(r'[a-f0-9]{64}',proof.get('payload_sha256',''))
                            or len(result['items'])!=min(100,max(0,total-(page-1)*100))):
                        raise ValueError('incomplete_collection_evidence')
                revision = self.store.get('watchlist')['registry_revision']
                for item in result['items']:
                    if not re.fullmatch(r'BV[1-9A-HJ-NP-Za-km-z]{10}', item.get('bvid', '')):
                        continue
                    if item.get('uid') is None and source['type'] != 'view':
                        view = dict(uid=source['uid'], type='view', id=item['bvid'], origin_keys=[key])
                        view_key = self.key(view)
                        state = self.store.cursor(view_key)
                        view['origin_keys'] = sorted(set(view['origin_keys'] + state.get('source', {}).get('origin_keys', [])))
                        self.store.save_cursor(view_key, {**state, 'source': view})
                        work.append(view)
                        continue
                    if item.get('uid') != source['uid']:
                        continue
                    report['new'] += bool(self.store.discover(source['uid'], item['bvid'], source.get('part', 1), result['url'], item.get('title', '')[:4096], revision))
                end = result['reached_end']
                cursor.update(source=source,checked_at=now_iso(),page=1 if end else page + 1, next_retry_at=next_daily() if end else 0,
                              last_success=dict(at=now_iso(), page=page, obtained=len(result['items']), reached_end=end, url=result['url'],**({'collection':result['collection']} if result.get('collection') else {})),
                              failures=0, error_code=None,http_status=result.get('http_status',200),business_code=result.get('business_code',0))
                self.store.save_cursor(key, cursor)
                report['ok'] += 1
                if not end:
                    work.append(source)
            except Exception as error:
                failures = cursor['failures'] + 1
                cursor.update(source=source,checked_at=now_iso(),failures=failures, error_code=error.code if isinstance(error,SourceFailure) else type(error).__name__,
                              **(dict(http_status=error.http_status,business_code=error.business_code) if isinstance(error,SourceFailure) else {}),
                              next_retry_at=now + min(21600, 60 * 2 ** min(failures, 8)))
                self.store.save_cursor(key, cursor)
                report['restricted' if isinstance(error,SourceFailure) and error.code=='official_source_restricted' else 'failed'] += 1
        self.store.set('last_scan', report)
        return report
