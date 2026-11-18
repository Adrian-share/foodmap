"""Offline fault/timing tests, never evidence of a live R1/R4 pass."""
import json,tempfile,unittest,uuid,hashlib,subprocess
from datetime import datetime,timezone,timedelta
from pathlib import Path
from foodmap_agent.release_audit import RoundTrip,PublicationAudit,store_ids
from foodmap_agent.http_client import PublicHTTPError
OLD='v1-'+'a'*64;NEW='v1-'+'b'*64
NODE=Path(__file__).resolve().parents[2]/'tools/node-v22.23.5-darwin-arm64/bin/node'
def wire_bytes(op):
 return subprocess.check_output([str(NODE),'-e','process.stdout.write(JSON.stringify(JSON.parse(process.argv[1])))',json.dumps(op)])
class ReleaseAudit(unittest.TestCase):
 def test_fixture_service_never_installs_a_live_site_reader_implicitly(self):
  from foodmap_agent.queue import Store
  from foodmap_agent.service import Service
  with tempfile.TemporaryDirectory() as tmp:
   q=Store(tmp);self.addCleanup(q.close);root=Path(__file__).resolve().parents[2]
   self.assertIsNone(Service(q,root,mode='production').pipeline.publisher.observer)
   injected=object();self.assertIs(Service(q,root,mode='production',publication_observer=injected).pipeline.publisher.observer,injected)
 def prepared_case(self,tmp):
  current=dict(data_version=NEW,pointer_etag='e2',generation=2);receipts={};wire=[];cas=[]
  def operator(op):
   if op['operation']=='receipt.get':return receipts.get(op['target_request_id'],{'status':'not_found'})
   encoded=wire_bytes(op);wire.append(encoded)
   if len(wire)==1:
    receipts[op['request_id']]=dict(status='prepared',request_id=op['request_id']);raise TimeoutError('prepared before CAS')
   self.assertEqual(encoded,wire[0],'actual JSON.stringify-order fingerprint must stay identical')
   self.assertEqual(op['expected_pointer_etag'],current['pointer_etag']);cas.append(op['request_id']);current.update(data_version=OLD,pointer_etag='e3',generation=3,transition_id=op['request_id'])
   receipts[op['request_id']]=dict(status='committed',request_id=op['request_id'],data_version=OLD,pointer_etag='e3');return receipts[op['request_id']]
  a=RoundTrip(Path(tmp),operator,lambda:dict(current));a.save_plan(dict(plan_id=str(uuid.uuid4()),current=dict(current),target_version=OLD,restore_version=NEW))
  return a,wire,cas,current
 def test_first_send_matches_frozen_wire_bytes_even_before_retry(self):
  with tempfile.TemporaryDirectory() as tmp:
   a,wire,_,_=self.prepared_case(tmp)
   with self.assertRaises(TimeoutError):a.execute('rollback')
   frozen=json.loads((Path(tmp)/'rollback-operation.json').read_text())
   self.assertEqual(hashlib.sha256(wire[0]).hexdigest(),hashlib.sha256(wire_bytes(frozen)).hexdigest())
 def test_committed_cas_with_failed_public_readback_reconciles_before_restore(self):
  with tempfile.TemporaryDirectory() as tmp:
   current=dict(data_version=NEW,pointer_etag='e2',generation=2);receipts={};posts=[];fail=[False]
   def pointer():
    if fail[0]:fail[0]=False;raise PublicHTTPError(503)
    return dict(current)
   def operator(op):
    if op['operation']=='receipt.get':return receipts.get(op['target_request_id'],{'status':'not_found'})
    posts.append(op);current.update(data_version=op['data_version'],pointer_etag='e'+str(current['generation']+1),generation=current['generation']+1,transition_id=op['request_id'])
    r=dict(request_id=op['request_id'],status='committed',data_version=op['data_version'],pointer_etag=current['pointer_etag']);receipts[op['request_id']]=r
    if len(posts)==1:fail[0]=True
    return r
   a=RoundTrip(Path(tmp),operator,pointer);a.save_plan(dict(plan_id=str(uuid.uuid4()),current=dict(current),target_version=OLD,restore_version=NEW))
   with self.assertRaises(PublicHTTPError):a.execute('rollback')
   self.assertTrue((Path(tmp)/'rollback-receipt.json').exists());self.assertFalse((Path(tmp)/'rollback-result.json').exists())
   a.execute('restore');self.assertEqual(current['data_version'],NEW);self.assertEqual(len(posts),2);self.assertEqual(current['generation'],4)
 def test_prepared_disconnect_resumes_exact_body_once_and_committed_replay_never_posts(self):
  with tempfile.TemporaryDirectory() as tmp:
   a,wire,cas,current=self.prepared_case(tmp)
   with self.assertRaises(TimeoutError):a.execute('rollback')
   self.assertEqual(current['generation'],2)
   a.execute('rollback');a.execute('rollback')
   self.assertEqual(len(wire),2);self.assertEqual(len(cas),1);self.assertEqual(current['generation'],3)
 def test_publisher_probe_wraps_commit_and_its_failure_does_not_unpublish(self):
  from foodmap_agent.queue import Store
  from foodmap_agent.publisher import Publisher
  with tempfile.TemporaryDirectory() as tmp:
   q=Store(tmp);self.addCleanup(q.close);events=[]
   class Probe:
    def begin(self,*_):events.append('before');return {}
    def complete(self,*_):
     self_outer.assertEqual(q.get('last_publication')['status'],'committed');events.append('after');raise TimeoutError()
   self_outer=self
   def operator(body):
    if body is None:return {'current_publication':None}
    if body['operation']=='release.commit':events.append('commit')
    return dict(request_id=body['request_id'],status='committed' if body['operation']=='release.commit' else 'complete',data_version=body.get('data_version'))
   p=Publisher(q,operator,Probe());p.blob=lambda kind,raw,mime:hashlib.sha256(raw).hexdigest()
   r=dict(video={'bvid':'fixture','part':1},visit={'id':'fixture','screenshots':[]},review={'verification_id':'a'*64,'rules_version':'v2'})
   receipt=p.publish([r],[],[],source_commit='a'*40,registry_revision=3,baseline_version='fixture')
   self.assertEqual(events,['before','commit','after']);self.assertEqual(receipt['status'],'committed');self.assertEqual(q.get('publication_observation_error')['stage'],'after_commit')
 def test_frozen_legacy_store_ids_do_not_require_dynamic_amap_fields(self):
  self.assertEqual(store_ids({'records':[{'visit':{'store_id':'legacy:1'}},{'visit':{'store_id':'amap:POI1','amap_poi_id':'POI1'}}]}),{'legacy:1','amap:POI1'})
 def test_roundtrip_uses_rollback_both_directions_and_is_idempotent(self):
  with tempfile.TemporaryDirectory() as tmp:
   current={'data_version':NEW,'pointer_etag':'e2','generation':2};receipts={};posted=[]
   def operator(op):
    if op['operation']=='receipt.get':return receipts.get(op['target_request_id'],{'status':'not_found'})
    self.assertEqual(op['operation'],'release.rollback');self.assertEqual(op['expected_parent_version'],current['data_version']);self.assertEqual(op['expected_pointer_etag'],current['pointer_etag']);posted.append(op)
    current.update(data_version=op['data_version'],generation=current['generation']+1,pointer_etag='e'+str(current['generation']+1),transition_id=op['request_id'])
    receipts[op['request_id']]={'request_id':op['request_id'],'status':'committed','data_version':op['data_version'],'pointer_etag':current['pointer_etag']};return receipts[op['request_id']]
   plan=dict(plan_id=str(uuid.uuid4()),current=dict(current),target_version=OLD,restore_version=NEW)
   a=RoundTrip(Path(tmp),operator,lambda:dict(current));a.save_plan(plan)
   a.execute('rollback');self.assertEqual(current['data_version'],OLD)
   a.execute('restore');self.assertEqual(current['data_version'],NEW);self.assertEqual(len(posted),2)
   a.execute('rollback');a.execute('restore');self.assertEqual(len(posted),2)
 def test_stale_preflight_never_overwrites_a_new_pointer(self):
  with tempfile.TemporaryDirectory() as tmp:
   posted=[];p=dict(plan_id=str(uuid.uuid4()),current=dict(data_version=NEW,pointer_etag='e2',generation=2),target_version=OLD,restore_version=NEW)
   a=RoundTrip(Path(tmp),lambda op:posted.append(op) or {'status':'not_found'},lambda:dict(data_version=NEW,pointer_etag='other',generation=3));a.save_plan(p)
   with self.assertRaisesRegex(RuntimeError,'pointer_changed'):a.execute('rollback')
   self.assertFalse(any(x['operation']=='release.rollback' for x in posted))
 def test_rollback_visibility_never_qualifies_as_new_content_R4(self):
  with tempfile.TemporaryDirectory() as tmp:
   a=PublicationAudit(Path(tmp),read=lambda _:None)
   self.assertFalse(a.qualifies('rollback_restore',{'old'}, {'old','restored'}))
   self.assertFalse(a.qualifies('new_content',{'same'},{'same'}))
   self.assertTrue(a.qualifies('new_content',{'old'},{'old','new'}))
 def test_late_or_missing_search_response_cannot_pass_sixty_second_gate(self):
  self.assertFalse(PublicationAudit.within_sixty(0,63.482174))
  self.assertFalse(PublicationAudit.within_sixty(0,None))
  self.assertTrue(PublicationAudit.within_sixty(0,60))
 def exercise_probe(self,age):
  with tempfile.TemporaryDirectory() as tmp:
   image=b'offline image';digest=hashlib.sha256(image).hexdigest();stamp=(datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat();calls=[]
   target=dict(video=dict(bvid='BV1NG6kYTEXG',part=1),visit=dict(id='new',amap_poi_id='POI1',screenshots=[dict(path='content/images/'+digest+'.png',sha256=digest)]));target_id='BV1NG6kYTEXG:1:new'
   def read(path):
    calls.append(path)
    if path=='/api/content/current':
     n=calls.count(path)
     if n==1:return dict(data_version=OLD)
     if n==2:raise PublicHTTPError(403)
     return dict(data_version=NEW,committed_at=stamp)
    if path.startswith('/api/content/snapshot'):return dict(records=[dict(visit_id='old')])
    if path=='/api/content':return dict(data_version=NEW,records=[dict(visit_id='old'),dict(visit_id=target_id)])
    return dict(data_version=NEW,status='ok',results=[dict(id='amap:POI1')])
   a=PublicationAudit(Path(tmp),read=read,resource=lambda path:(image if '/images/' in path else b'<html>',{'Content-Type':'image/png' if '/images/' in path else 'text/html'}))
   value=a.begin(NEW,[target],OLD);result=a.complete(value,dict(checked_at=stamp),timeout=.5,interval=0)
   self.assertEqual(result['probes'][0]['http_status'],403);self.assertEqual(result['status'],'observed')
   self.assertEqual(result['full_R4_status'],'pending_root_browser_review');self.assertFalse(result['details'][0]['browser_playback_advance_proven'])
   self.assertTrue(any(p.startswith('/api/nearby?') and 'data_version=' not in p for p in calls))
   return result
 def test_continuous_probe_keeps_http_rejection_and_requires_unpinned_search(self):
  self.assertTrue(self.exercise_probe(0)['within_sixty_seconds'])
 def test_real_probe_path_rejects_late_receipt_even_when_search_now_succeeds(self):
  self.assertFalse(self.exercise_probe(63.482174)['within_sixty_seconds'])
