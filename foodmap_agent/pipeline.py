"""Pi proposals never cross the public boundary without independently checked evidence."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import time
from .publisher import Publisher
from .watchlist import now_iso

class Pipeline:
    def __init__(self, store, root, node, operator, source_commit):
        self.store, self.root, self.node = store, Path(root), Path(node)
        self.publisher = Publisher(store, operator)
        self.source_commit = source_commit

    def event(self, job, stage, **fields):
        key='pipeline_events:'+job['id']
        events=self.store.get(key, [])
        events.append(dict(stage=stage,checked_at=now_iso(),**fields))
        self.store.set(key,events[-20:])

    def _read(self, root, item, limit=512*1024):
        base = root.resolve(strict=True)
        relative = Path(item['file'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('outside_evidence_root')
        file = base
        for part in relative.parts:
            file = file / part
            if file.is_symlink():
                raise ValueError('symlink_evidence')
        if root.is_symlink() or not file.resolve(strict=True).is_relative_to(base) or not file.is_file() or file.stat().st_size > limit:
            raise ValueError('invalid_evidence_file')
        raw = file.read_bytes()
        if len(raw) > limit or hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError('evidence_hash_mismatch')
        return raw

    def verify(self, job, result, context, model):
        sources = []
        root = Path(context['root'])
        for key, entry in context['evidence'].items():
            if not entry.get('kind'):
                continue  # discovery is a lead, never proof
            raw = self._read(root, entry)
            sources.append(dict(id=key, kind=entry['kind'], sha256=entry['sha256'], payload=json.loads(raw),
                                source_url=entry['source_url'], checked_at=entry['checked_at']))
        value = dict(checked_at=now_iso(), identity={k: context[k] for k in ('task_id','creator_uid','bvid','part')},
                     pi=dict(package='@earendil-works/pi-coding-agent', version='1.5.2', provider=model['provider'],
                             model=model['model'], session_id=result['session_id'], settled_aborted=result['settled'].get('aborted')),
                     proposal=result['proposal'], sources=sources)
        proc = subprocess.run([str(self.node), str(self.root / 'scripts/agent-verify.cjs')],
                              input=json.dumps(value), capture_output=True, text=True, timeout=20,
                              env={'PATH':'/usr/bin:/bin'}, cwd=self.root)
        if proc.returncode or len(proc.stdout)>32*1024*1024:
            raise RuntimeError('verification_failed')
        verified=json.loads(proc.stdout)
        for document in verified['documents']:
            document['bytes'] = base64.b64decode(document.pop('bytes_base64'))
        images = []
        referenced={s['sha256']:s['path'] for r in verified['records'] for s in r['visit']['screenshots']}
        for source in sources:
            if source['kind'] != 'frame':
                continue
            frame=source['payload']
            if frame['sha256'] not in referenced:
                continue  # Unselected capture/OCR samples remain private evidence.
            entry=context.get('frame_files',{}).get(frame['sha256'])
            if not entry:
                verified.update(status='pending',missing=['frame_bytes'],records=[],documents=[])
                break
            raw=self._read(root, entry, 8*1024*1024)
            images.append(dict(sha256=frame['sha256'],path=referenced[frame['sha256']],
                               mime_type=frame['mime_type'],bytes=len(raw),width=frame['width'],height=frame['height'],data=raw))
        return verified, list({i['path']:i for i in images}.values())

    def advance(self, job, result, context, model, publish=True):
        verified, images=self.verify(job,result,context,model)
        missing=verified['missing']
        documents=verified['documents']
        proof=documents[0]['document']['verification'] if documents else {}
        self.store.set('verification:'+job['id'],dict(status=verified['status'],missing=missing,checked_at=now_iso(),
                       rules_version=proof.get('rules_version'),provenance=proof.get('provenance',[])))
        if verified['status'] != 'approved':
            stage='blocked_capture' if 'frame' in missing or 'frame_bytes' in missing or 'frame' in result['proposal']['missing'] else 'pending'
            self.store.db.execute('UPDATE jobs SET stage=?,error_code=?,next_retry_at=? WHERE id=?',(stage,','.join(missing)[:100],1e15 if verified['status']=='excluded' else time.time()+21600,job['id']))
            self.event(job,stage,missing=missing)
            return None
        self.event(job,'verified',rules_version=proof.get('rules_version'))
        # Save the exact plan/evidence before transport; retries must not regenerate timestamps.
        prepared = dict(records=verified['records'],documents=[dict(sha256=d['sha256'],bytes_base64=base64.b64encode(d['bytes']).decode()) for d in verified['documents']],
                        images=[{k:v for k,v in i.items() if k!='data'} for i in images],context=context)
        self.store.set('publish:'+job['id'],prepared)
        self.store.db.execute("UPDATE jobs SET stage='staged' WHERE id=?",(job['id'],))
        self.event(job,'staged')
        return self.resume(job, prepared) if publish else None

    def resume(self, job, prepared=None):
        prepared=prepared or self.store.get('publish:'+job['id'])
        if not prepared:
            raise RuntimeError('missing_publication_plan')
        documents=[dict(sha256=d['sha256'],bytes=base64.b64decode(d['bytes_base64'])) for d in prepared['documents']]
        images=[]
        for image in prepared['images']:
            raw=self._read(Path(prepared['context']['root']),prepared['context']['frame_files'][image['sha256']],8*1024*1024)
            images.append({**image,'data':raw})
        registry=self.store.get('watchlist',{}).get('registry_revision')
        if not registry:
            raise RuntimeError('registry_not_active')
        baseline=self.store.get('baseline')['version']
        receipt=self.publisher.publish(prepared['records'],documents,images,source_commit=self.source_commit,
                                       registry_revision=registry,baseline_version=baseline)
        self.store.set('publication:'+job['id'],receipt)
        self.store.db.execute("UPDATE jobs SET stage='published',error_code=NULL WHERE id=?",(job['id'],))
        self.event(job,'published',data_version=receipt['data_version'])
        return receipt
