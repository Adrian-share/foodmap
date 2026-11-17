"""Project status uses the existing bounded candidate snapshot contract."""
import json
from urllib.parse import urlencode
from .watchlist import now_iso

def source_url(source):
    uid=source['uid']
    if source['type']=='posts':
        return 'https://api.bilibili.com/x/space/wbi/arc/search?'+urlencode(dict(mid=uid,pn=1,ps=30))
    if source['type']=='season':
        if source.get('anchor_bvid'):
            return 'https://api.bilibili.com/x/web-interface/view?'+urlencode(dict(bvid=source['anchor_bvid']))
        return 'https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?'+urlencode(dict(mid=uid,season_id=source['id'],page_num=1,page_size=30))
    return 'https://api.bilibili.com/x/web-interface/view?'+urlencode(dict(bvid=source['id']))

def snapshot(store):
    now=now_iso();accounts=[];discoveries=[];videos=[]
    for source in store.sources():
        cursors=[c for c in store.cursors() if c.get('source',{}).get('uid')==source['uid']]
        if not cursors:
            continue
        latest=max(cursors,key=lambda c:c.get('checked_at',''))
        checked=latest.get('checked_at')
        if not checked:
            continue
        success=latest.get('last_success')
        rows=[{k:c.get(k) for k in ('key','page','next_retry_at','failures','error_code','http_status','business_code','last_success','checked_at')} for c in cursors[:20]]
        error=json.dumps(dict(schema_version=1,kind='source_status',cursors=rows),separators=(',',':'))
        while len(error.encode())>4000 and rows:
            rows.pop();error=json.dumps(dict(schema_version=1,kind='source_status',cursors=rows),separators=(',',':'))
        accounts.append(dict(uid=source['uid'],checked_at=checked,url=source_url(latest['source']),code=0 if not latest.get('error_code') else -1,
                             scope='按UID和来源独立游标；不代表账号完整历史',last_page=success['page'] if success else 0,
                             reached_end=success['reached_end'] if success else False,obtained=success['obtained'] if success else 0,
                             error=error,
                             restriction=latest.get('error_code'),next_step='按next_retry_at重试，保留上次成功范围'))
    for video in store.videos():
        sources=[s for s in video['sources'] if isinstance(s,str) and s.startswith('https://api.bilibili.com/')]
        if sources:
            discoveries.append(dict(bvid=video['bvid'],creator_uid=video['uid'],owner_verified=True,title=video['title'],source=sources[0],discovered_at=now,checked_at=now))
    for job in store.jobs():
        saved=store.get('extraction:'+job['id'])
        if not saved:
            continue
        context=saved['context'];metadata=context['evidence'].get('metadata')
        if not metadata:
            continue
        # Metadata was already owner-checked by the adapter. Read only its registered file.
        try:
            from .pipeline import Pipeline
            raw=Pipeline._read(None,__import__('pathlib').Path(context['root']),metadata)
            data=json.loads(raw)['data']
            if str(data['owner']['mid'])!=job['uid'] or data['bvid']!=job['bvid']:
                continue
        except (OSError,ValueError,KeyError):
            continue
        verification=store.get('verification:'+job['id'],{})
        publication=store.get('publication:'+job['id'],{})
        status=dict(schema_version=1,kind='pipeline_status',stage=job['stage'],result=verification.get('status'),
                    missing=verification.get('missing',[]),data_version=publication.get('data_version'),error_code=job['error_code'],
                    rules_version=verification.get('rules_version'),provenance=verification.get('provenance',[]),
                    history=store.get('pipeline_events:'+job['id'],[])[-6:])
        videos.append(dict(bvid=job['bvid'],owner_uid=job['uid'],owner_verified=True,url=metadata['source_url'],checked_at=now,code=0,title=data['title'],
                           error=json.dumps(status,separators=(',',':'))))
    value=dict(schema=1,updated_at=now,discoveries=discoveries,accounts=accounts,seasons=[],videos=videos)
    scan=store.get('last_scan')
    if not scan:
        return value
    restricted=scan.get('restricted',0)
    partial=bool(scan['failed'] or restricted or scan['deferred'] or scan['skipped_limit'])
    outcome='backoff_unchecked' if not scan['checked'] and scan['deferred'] else 'no_sources_checked' if not scan['checked'] else 'source_failed' if scan['failed'] else 'source_restricted' if restricted else 'new_candidates' if scan['new'] else 'partial_no_new' if partial else 'no_new'
    run=dict(run_id='python:'+scan['checked_at'],checked_at=scan['checked_at'],outcome=outcome,partial=partial,
             sources_checked=scan['checked'],sources_ok=scan['ok'],sources_restricted=restricted,sources_failed=scan['failed'],new_count=scan['new'])
    return dict(snapshot=value,run=run)
