"""Bounded public evidence and an explicit, journaled two-CAS rollback exercise."""
import hashlib,json,os,re,time,uuid
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urlencode,urlsplit
from urllib.request import Request,build_opener
from urllib.error import HTTPError
from .http_client import ORIGIN,PUBLIC_HEADERS,NoRedirect,PublicHTTPError
from .publisher import canonical

def utc():return datetime.now(timezone.utc).isoformat()
def epoch(value):return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
def write_json(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    temp=path.with_name('.'+path.name+'.'+str(uuid.uuid4())+'.tmp')
    with temp.open('x',encoding='utf-8') as f:
        os.chmod(temp,0o600);json.dump(value,f,ensure_ascii=False,sort_keys=True,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    os.replace(temp,path)

def public_resource(path,timeout=3):
    u=urlsplit(path)
    if u.scheme or u.netloc or u.fragment or '\\' in path:raise ValueError('invalid_public_path')
    allowed=u.path in ('/api/content/current','/api/content/snapshot','/api/content','/api/home/catalog','/api/nearby','/content/','/content/app.js') or re.fullmatch(r'/content/images/[A-Za-z0-9_.-]+\.(png|jpg|jpeg|webp)',u.path)
    if not allowed:raise ValueError('invalid_public_path')
    limit=8*1024*1024 if '/images/' in u.path else 32*1024*1024 if u.path.startswith('/api/') else 512*1024
    try:
        with build_opener(NoRedirect).open(Request(ORIGIN+path,headers={**PUBLIC_HEADERS,'Cache-Control':'no-cache'}),timeout=timeout) as r:
            if r.status!=200:raise PublicHTTPError(r.status)
            raw=r.read(limit+1)
            if len(raw)>limit:raise ValueError('public_body_too_large')
            return raw,dict(r.headers)
    except HTTPError as error:raise PublicHTTPError(error.code) from None

def public_json(path):return json.loads(public_resource(path)[0])
def visit_ids(snapshot):return {r['visit_id'] for r in snapshot['records']}
def store_ids(snapshot):return {r['visit'].get('store_id') or 'amap:'+r['visit']['amap_poi_id'] for r in snapshot['records']}

def verify_public_version(version,read=public_json,resource=public_resource):
    if not re.fullmatch(r'v1-[a-f0-9]{64}',version):raise ValueError('invalid_version')
    snapshot=read('/api/content/snapshot?'+urlencode({'data_version':version}))
    catalog=read('/api/home/catalog?'+urlencode({'data_version':version}))
    if snapshot.get('data_version')!=version or catalog.get('data_version')!=version:raise RuntimeError('public_version_mismatch')
    references={s['path']:s['sha256'] for r in snapshot['records'] for s in r['visit']['screenshots']}
    images=[]
    for path,digest in sorted(references.items()):
        raw,headers=resource('/'+path.lstrip('/'))
        if hashlib.sha256(raw).hexdigest()!=digest:raise RuntimeError('public_image_hash_mismatch')
        content_type=next((v for k,v in headers.items() if k.lower()=='content-type'),'')
        if not content_type.startswith('image/'):raise RuntimeError('public_image_type_mismatch')
        images.append(dict(path=path,sha256=digest,bytes=len(raw),http_status=200,content_type=content_type))
    return dict(data_version=version,visit_ids=sorted(visit_ids(snapshot)),store_ids=sorted(store_ids(snapshot)),unique_stores=len(store_ids(snapshot)),images=images,snapshot=snapshot,catalog=catalog)

class RoundTrip:
    """Only explicit execute() writes; preflight/plan creation never POSTs."""
    def __init__(self,journal,operator,current,verify=None):
        self.journal=Path(journal);self.operator=operator;self.current=current;self.verify=verify
    def save_plan(self,plan):
        file=self.journal/'plan.json'
        if file.exists():raise RuntimeError('plan_already_frozen')
        write_json(file,plan)
    def execute(self,step):
        if step not in ('rollback','restore'):raise ValueError('invalid_step')
        plan=json.loads((self.journal/'plan.json').read_text());file=self.journal/(step+'-operation.json')
        if file.exists():body=json.loads(canonical(json.loads(file.read_text())))
        else:
            if step=='restore' and not (self.journal/'rollback-result.json').exists():
                receipt_file=self.journal/'rollback-receipt.json'
                if not receipt_file.exists():raise RuntimeError('rollback_not_confirmed_reconcile_first')
                self.execute('rollback')  # Reconcile the committed first CAS, never invent an ETag.
            parent=plan['current'] if step=='rollback' else json.loads((self.journal/'rollback-result.json').read_text())['current']
            target=plan['target_version'] if step=='rollback' else plan['restore_version']
            live=self.current()
            if live['data_version']!=parent['data_version'] or live['pointer_etag']!=parent['pointer_etag']:raise RuntimeError('pointer_changed_since_preflight')
            body=json.loads(canonical(dict(schema_version=1,operation='release.rollback',request_id=str(uuid.uuid5(uuid.NAMESPACE_URL,plan['plan_id']+':'+step)),data_version=target,expected_parent_version=parent['data_version'],expected_pointer_etag=parent['pointer_etag'],reason='FACT-33 reviewed R1 '+step)))
            write_json(file,body)  # Freeze exact bytes and ID before any POST.
        wire=canonical(body);wirefile=self.journal/(step+'-wire.json')
        if wirefile.exists():
            if wirefile.read_bytes()!=wire:raise RuntimeError('frozen_operation_body_changed')
        else:
            with wirefile.open('xb') as f:os.chmod(wirefile,0o600);f.write(wire);f.flush();os.fsync(f.fileno())
        lookup=lambda:self.operator(dict(schema_version=1,operation='receipt.get',request_id=str(uuid.uuid4()),target_request_id=body['request_id']))
        receipt=lookup()
        if receipt['status'] in ('not_found','prepared'):
            live=self.current()
            if live['data_version']!=body['expected_parent_version'] or live['pointer_etag']!=body['expected_pointer_etag']:raise RuntimeError('pointer_changed_before_cas')
            write_json(self.journal/(step+'-send-start.json'),dict(at=utc(),operation=body))
            try:receipt=self.operator(body)
            except Exception:
                receipt=lookup()
                if receipt['status']!='committed':raise
        if receipt.get('status')!='committed' or receipt.get('request_id')!=body['request_id'] or receipt.get('data_version')!=body['data_version']:raise RuntimeError('rollback_not_confirmed')
        write_json(self.journal/(step+'-receipt.json'),dict(status='committed_receipt_readback_pending',operation=body,receipt=receipt))
        readback=lookup()
        if readback.get('status')!='committed' or readback.get('request_id')!=body['request_id'] or readback.get('data_version')!=body['data_version']:raise RuntimeError('receipt_readback_mismatch')
        write_json(self.journal/(step+'-receipt.json'),dict(status='committed_pending_public_readback',operation=body,receipt=receipt,readback=readback))
        live=self.current();result_file=self.journal/(step+'-result.json')
        # A completed old step must never be POSTed again after restoration.
        if result_file.exists():
            result=json.loads(result_file.read_text())
            if self.verify and result.get('verification_status')!='passed':
                result.update(verification=self.verify(body['data_version']),verification_status='passed');write_json(result_file,result)
            return result
        if live.get('data_version')!=body['data_version'] or live.get('pointer_etag')!=receipt['pointer_etag'] or live.get('transition_id')!=body['request_id']:raise RuntimeError('committed_pointer_mismatch')
        result=dict(fixture=False,step=step,checked_at=utc(),current=live,receipt=receipt,receipt_readback=readback,verification_status='pending',qualifies_for_new_content_R4=False)
        write_json(result_file,result)  # Keep the restore CAS available even if a probe fails.
        if self.verify:
            try:result.update(verification=self.verify(body['data_version']),verification_status='passed')
            except Exception as error:
                result['verification_error']=type(error).__name__;write_json(result_file,result)
                raise RuntimeError('public_verification_failed_restore_remains_available') from error
        write_json(result_file,result);return result

class PublicationAudit:
    def __init__(self,root,read=public_json,resource=public_resource):self.root=Path(root);self.read=read;self.resource=resource
    @staticmethod
    def qualifies(intent,before,after):return intent=='new_content' and bool(after-before)
    @staticmethod
    def within_sixty(committed,visible):return visible is not None and 0<=visible-committed<=60
    def begin(self,version,records,parent,intent='new_content'):
        current=self.read('/api/content/current');before=self.read('/api/content/snapshot?'+urlencode({'data_version':current['data_version']}))
        folder=self.root/version/(datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')+'-'+str(uuid.uuid4()))
        targets=[dict(visit_id=r['video']['bvid']+':'+str(r['video']['part'])+':'+r['visit']['id'],bvid=r['video']['bvid'],part=r['video']['part'],poi=r['visit']['amap_poi_id'],screenshots=r['visit']['screenshots']) for r in records]
        value=dict(fixture=False,intent=intent,data_version=version,parent_version=parent,begin_at=utc(),before_current=current,before_visit_ids=sorted(visit_ids(before)),targets=targets,probes=[],status='prepared',folder=str(folder))
        write_json(folder/'before-snapshot.json',before);write_json(folder/'observation.json',value);return value
    def complete(self,value,receipt,timeout=60,interval=2):
        folder=Path(value['folder']);value.update(receipt=receipt,commit_response_received_at=utc(),status='observing');deadline=time.monotonic()+timeout
        expected={x['visit_id'] for x in value['targets']};seen=None;valid_images=False;details=[]
        # Recovery of an old receipt is recorded, never relabeled as a fresh publish.
        value['prepared_before_commit']=epoch(receipt['checked_at'])>=epoch(value['begin_at'])
        eligible=value['prepared_before_commit'] and value['before_current']['data_version']==value['parent_version'] and self.qualifies(value['intent'],set(value['before_visit_ids']),expected|set(value['before_visit_ids']))
        while time.monotonic()<deadline:
            probe=dict(request_started_at=utc())
            try:
                pointer=self.read('/api/content/current');probe['current']=pointer
                if pointer.get('data_version')==value['data_version']:
                    if pointer.get('transition_id')!=receipt['request_id']:raise RuntimeError('publication_transition_mismatch')
                    content=self.read('/api/content');nearby=self.read('/api/nearby?'+urlencode(dict(location='北京王府井地铁站',city='北京',limit=50)))
                    available=visit_ids(content);pois={x['id'].removeprefix('amap:') for x in nearby.get('results',[])}
                    search_ok=nearby.get('status')=='ok' and nearby.get('data_version')==value['data_version'] and {x['poi'] for x in value['targets']}<=pois
                    if content.get('data_version')==value['data_version'] and expected<=available and search_ok:
                        if seen is None:
                            seen=time.time();value['first_search_response_at']=utc();value['first_search_request_started_at']=probe['request_started_at']
                            write_json(folder/'first-search-content.json',content);write_json(folder/'first-search-nearby.json',nearby)
                            anchor=min(epoch(receipt['checked_at']),epoch(pointer['committed_at']))
                            value['seconds_commit_to_first_search']=seen-anchor
                            value['within_sixty_seconds']=eligible and self.within_sixty(anchor,seen)
                            value['qualifies_for_new_content_R4']=eligible
                        images=[]
                        for target in value['targets']:
                            for image in target['screenshots']:
                                raw,headers=self.resource('/'+image['path'].lstrip('/'))
                                if hashlib.sha256(raw).hexdigest()!=image['sha256']:raise RuntimeError('public_image_hash_mismatch')
                                if not next((v for k,v in headers.items() if k.lower()=='content-type'),'').startswith('image/'):raise RuntimeError('public_image_type_mismatch')
                                images.append(dict(path=image['path'],sha256=image['sha256'],bytes=len(raw),http_status=200,checked_at=utc()))
                            url='/content/?'+urlencode(dict(visit_id=target['visit_id'],data_version=value['data_version']))
                            self.resource(url);details.append(dict(url=ORIGIN+url,http_status=200,bvid=target['bvid'],part=target['part'],browser_playback_advance_proven=False))
                        value.update(images=images,details=details);valid_images=True
                        probe['searchable']=True
            except Exception as error:probe.update(error_code=type(error).__name__,http_status=getattr(error,'status',None))
            probe['request_finished_at']=utc();value['probes'].append(probe);write_json(folder/'observation.json',value)
            if valid_images or not eligible:break
            time.sleep(min(interval,max(0,deadline-time.monotonic())))
        value.update(status='observed' if valid_images else 'pending',finished_at=utc(),full_R4_status='pending_root_browser_review',fixture=False)
        value.setdefault('within_sixty_seconds',False);value.setdefault('qualifies_for_new_content_R4',False)
        write_json(folder/'observation.json',value);return value
