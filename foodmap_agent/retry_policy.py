"""Evidence-based waiting is not a model confidence decision or an approval."""
import hashlib,json,re
from pathlib import Path
from urllib.parse import urlsplit

def tool_error(event):
    """Keep only fixed tool outcome codes, never the model's narrative."""
    if event.get('toolName') not in ('content_fetch_metadata','content_capture_frame','content_search_poi','content_read_evidence'):
        return None
    result=event.get('result',{})
    if not isinstance(result,dict):result={}
    payloads=[result]
    for block in result.get('content',[]):
        if block.get('type')=='text':
            try:payloads.append(json.loads(block.get('text','')))
            except (ValueError,TypeError):pass
    for payload in payloads:
        if not isinstance(payload,dict):continue
        code=payload.get('error_code')
        if event.get('isError') or result.get('isError') or code or payload.get('status') in ('blocked_capture','pending_transport'):
            return dict(tool=event['toolName'],error_code=code if isinstance(code,str) and re.fullmatch(r'[A-Za-z0-9_]{1,80}',code) else 'tool_execution_failed')
    return None

def review_policy(job,result,context,verified,read):
    # Fingerprint excludes discovery/title/checked_at: unchanged proof is not new
    # evidence. The full source hashes and original image bytes are revalidated.
    fingerprint=hashlib.sha256(json.dumps(dict(evidence={k:v.get('sha256') for k,v in context.get('evidence',{}).items() if k!='discovery'},
       frames={k:v.get('sha256') for k,v in context.get('frame_files',{}).items()}),sort_keys=True,separators=(',',':')).encode()).hexdigest()
    def policy(action,reason,**extra):return dict(version='pending-review-v1',action=action,reason=reason,evidence_sha256=fingerprint,**extra)
    retry=lambda why:policy('retry_transient',why)
    if result.get('settled',{}).get('aborted') is not False:return retry('no_successful_settled')
    if not isinstance(result.get('tool_errors'),list):return retry('tool_outcome_audit_missing')
    if result['tool_errors']:return policy('retry_transient','registered_tool_error',tool_errors=result['tool_errors'])
    if verified.get('status')!='pending' or not set(verified.get('missing',[]))&{'branch','poi'}:
        return retry('no_machine_branch_gap')
    if set(verified.get('missing',[]))-{'branch','poi','description','source_access'}:return retry('other_verification_gap')
    try:
        expected=dict(task_id=job['id'],creator_uid=job['uid'],bvid=job['bvid'],part=job['part'])
        if any(context.get(k)!=v for k,v in expected.items()):return retry('evidence_identity_mismatch')
        root=Path(context['root']);sources=[]
        for key,entry in context.get('evidence',{}).items():
            if entry.get('kind'):
                url=urlsplit(entry.get('source_url',''));kind=entry['kind']
                valid=(url.hostname=='api.bilibili.com' and url.path=='/x/web-interface/view' if kind=='metadata' else
                       url.hostname=='restapi.amap.com' and url.path=='/v5/place/text' if kind=='poi' else
                       url.hostname=='www.bilibili.com' and url.path=='/video/'+job['bvid']+'/' if kind in ('frame','branch') else
                       (url.hostname or '').endswith('.hdslb.com') if kind=='subtitle' else False)
                if url.scheme!='https' or url.username or url.password or url.port or not valid:return retry('untrusted_source')
                sources.append((kind,json.loads(read(root,entry))))
        meta=next(p for kind,p in sources if kind=='metadata');data=meta['data']
        page=next(p for p in data['pages'] if p['page']==job['part'])
        if meta['code']!=0 or data['bvid']!=job['bvid'] or str(data['owner']['mid'])!=job['uid']:return retry('metadata_identity_mismatch')
        # Narrow, auditable initial rule: an absent official description plus no
        # street/address in registered OCR/subtitles, or a same-street multi-branch
        # conflict. Other incomplete/failed requests retain the retry path.
        description=str(data.get('desc','')).strip()
        text=[];frames=[];pois=[]
        for kind,p in sources:
            if kind in ('frame','branch','subtitle') and (p.get('bvid')!=job['bvid'] or p.get('part')!=job['part'] or p.get('cid')!=page['cid']):return retry('artifact_identity_mismatch')
            if kind=='frame':
                if not (8<=p.get('mean',0)<=247 and p.get('stddev',0)>=8):return retry('unusable_frame')
                entry=context['frame_files'][p['sha256']]
                if entry.get('sha256')!=p['sha256']:return retry('frame_hash_binding_mismatch')
                read(root,entry,8*1024*1024);frames.append(p['sha256'])
            if kind=='branch':
                if p.get('engine')!='apple-vision-v1' or p.get('image_sha256') not in context['frame_files']:return retry('unbound_ocr')
                text.extend(l['text'] for l in p.get('lines',[]) if l.get('confidence',0)>=0.9)
            if kind=='subtitle':text.extend(l['content'] for l in p.get('body',[]))
            if kind=='poi':
                if p.get('status')!='1' or not isinstance(p.get('pois'),list):return retry('poi_access_error')
                pois.extend(p['pois'])
        if not frames or not pois:return retry('registered_frame_or_poi_missing')
        if description not in ('','-'):
            visits=result.get('proposal',{}).get('visits',[])
            brand=visits[0].get('store_name','') if len(visits)==1 else ''
            norm=lambda t:re.sub(r'[\s，,。·、（）()：:]','',str(t))
            matches={}
            if len(brand)>=2 and norm(description).startswith(norm(brand)):
                for poi in pois:
                    if poi.get('cityname')!='北京市' or not norm(poi.get('name','')).startswith(norm(brand)):continue
                    address=str(poi.get('address','')).removeprefix('北京市').removeprefix(poi.get('adname',''))
                    street=re.match(r'^([\u4e00-\u9fffA-Za-z0-9]{2,30}?(?:胡同|街道|大街|大道|路|街|巷|条))',address)
                    if street and norm(street[1].removesuffix('胡同')) in norm(description):matches.setdefault(street[1],set()).add(poi['id'])
            ambiguous={k:sorted(v) for k,v in matches.items() if len(v)>1}
            if ambiguous:return policy('await_new_evidence','ambiguous_amap_street_match',ambiguous_streets=ambiguous,original_frames=sorted(set(frames)))
            return retry('description_requires_review')
        joined=' '.join(text)
        if re.search(r'胡同|街|路|巷|条|[0-9一二三四五六七八九十]+号',joined):return retry('registered_address_requires_review')
        if any(p.get('address') and p['address'] in joined for p in pois):return retry('registered_address_requires_review')
        return policy('await_new_evidence','registered_sources_have_no_street',original_frames=sorted(set(frames)),poi_ids=sorted({p['id'] for p in pois if isinstance(p.get('id'),str)}))
    except (ValueError,KeyError,TypeError,OSError,StopIteration):return retry('unusable_or_unbound_evidence')
