"""Recover registered artifacts after a hard exit, never model instructions."""
import hashlib,json,os,re,stat
from pathlib import Path

def read_bound(root,name,limit,digest=None):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+',name):raise ValueError('invalid_cached_filename')
    path=root/name
    if path.is_symlink():raise ValueError('symlink_cached_evidence')
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    with os.fdopen(fd,'rb') as f:
        info=os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_size>limit:raise ValueError('invalid_cached_evidence_file')
        raw=f.read(limit+1)
    if len(raw)>limit or digest is not None and hashlib.sha256(raw).hexdigest()!=digest:raise ValueError('cached_evidence_hash_mismatch')
    return raw

def recover_registered(context):
    root=Path(context['root'])
    if root.is_symlink() or root.resolve(strict=True)!=root:raise ValueError('aliased_cached_root')
    file=root/'registered-context.json'
    if not file.exists() and not file.is_symlink():return None
    value=json.loads(read_bound(root,file.name,2*1024*1024))
    if value.get('schema_version')!=1 or any(value.get(k)!=context[k] for k in ('task_id','creator_uid','bvid','part','root')):
        raise ValueError('cached_task_identity_mismatch')
    evidence=value.get('evidence',{});frames=value.get('frame_files',{});budget=value.get('model_preview_bytes',0)
    if not isinstance(evidence,dict) or not isinstance(frames,dict) or type(budget) is not int or not 0<=budget<=96*1024:
        raise ValueError('invalid_cached_context')
    payloads={}
    for key,entry in evidence.items():
        if key=='discovery':continue  # Current discovery is rebuilt from SQLite.
        if not re.fullmatch(r'source-[a-f0-9]{64}\.json',entry['file']):raise ValueError('invalid_cached_source')
        payloads[key]=json.loads(read_bound(root,entry['file'],512*1024,entry['sha256']))
    for digest,entry in frames.items():
        if not re.fullmatch(r'[a-f0-9]{64}',digest) or entry['sha256']!=digest or entry['file']!='frame-'+digest+'.png':
            raise ValueError('invalid_cached_frame')
        read_bound(root,entry['file'],8*1024*1024,digest)
    meta=payloads.get('metadata')
    cid=None
    if meta:
        data=meta.get('data',{});page=next((p for p in data.get('pages',[]) if p.get('page')==context['part']),None)
        if meta.get('code')!=0 or data.get('bvid')!=context['bvid'] or str(data.get('owner',{}).get('mid'))!=context['creator_uid'] or not page:
            raise ValueError('cached_metadata_identity_mismatch')
        cid=page['cid']
    for key,payload in payloads.items():
        kind=evidence[key].get('kind')
        if kind in ('frame','branch','subtitle'):
            if payload.get('bvid')!=context['bvid'] or payload.get('part')!=context['part'] or cid is not None and payload.get('cid')!=cid:
                raise ValueError('cached_artifact_identity_mismatch')
        if kind=='frame' and payload.get('sha256') not in frames:raise ValueError('cached_frame_missing')
        if kind=='branch' and payload.get('image_sha256') not in frames:raise ValueError('cached_ocr_frame_missing')
    return dict(evidence={k:v for k,v in evidence.items() if k!='discovery'},frame_files=frames,model_preview_bytes=budget)
