"""Deterministic evidence holds never publish or spend model attempts."""
import copy,hashlib,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from foodmap_agent.pipeline import Pipeline
from foodmap_agent.queue import Store
from foodmap_agent.service import Service
ROOT=Path(__file__).resolve().parents[2]
class PendingReview(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.q=Store(self.tmp.name);self.addCleanup(self.q.close)
  self.q.discover('123','BV1NG6kYTEXG',1,'offline','offline',1);self.job=self.q.claim('owner');self.q.release(self.job['id'],'owner','verifying')
  root=Path(self.tmp.name)/'evidence'/self.job['id'];root.mkdir(parents=True)
  self.ctx=dict(root=str(root),task_id=self.job['id'],creator_uid='123',bvid=self.job['bvid'],part=1,evidence={},frame_files={})
  self.add('metadata','metadata',{'code':0,'data':{'bvid':self.job['bvid'],'owner':{'mid':123},'desc':'-','pages':[{'page':1,'cid':5}]}})
  raw=b'original bytes for isolated hash test';sha=hashlib.sha256(raw).hexdigest();(root/'frame.png').write_bytes(raw)
  self.ctx['frame_files'][sha]=dict(file='frame.png',sha256=sha)
  self.add('frame:1','frame',dict(bvid=self.job['bvid'],part=1,cid=5,sha256=sha,mean=100,stddev=30))
  self.add('poi:1','poi',{'status':'1','pois':[{'id':'one','address':'测试路1号'},{'id':'two','address':'另一路2号'}]})
  self.result=dict(proposal={'missing':['branch','poi']},settled={'aborted':False},tool_errors=[])
  self.verified=dict(status='pending',missing=['branch','poi'],documents=[])
  self.p=Pipeline(self.q,ROOT,ROOT/'tools/node-v22.23.5-darwin-arm64/bin/node',lambda _:None,'a'*40)
 def add(self,key,kind,payload):
  raw=json.dumps(payload).encode();name=key.replace(':','-')+'.json';(Path(self.ctx['root'])/name).write_bytes(raw)
  self.ctx['evidence'][key]=dict(file=name,sha256=hashlib.sha256(raw).hexdigest(),kind=kind,source_url='https://api.bilibili.com/x/web-interface/view' if kind=='metadata' else 'https://restapi.amap.com/v5/place/text' if kind=='poi' else 'https://www.bilibili.com/video/'+self.job['bvid']+'/')
 def advance(self):
  with patch.object(self.p,'verify',return_value=(self.verified,[])):self.p.advance(self.job,self.result,self.ctx,{})
 def test_settled_machine_absent_street_holds_without_six_hour_reclaim(self):
  self.advance();job=self.q.jobs()[0];self.assertEqual(job['stage'],'pending');self.assertEqual(job['next_retry_at'],0)
  policy=self.q.get('verification:'+job['id'])['retry_policy'];self.assertEqual(policy['action'],'await_new_evidence');self.assertEqual(policy['reason'],'registered_sources_have_no_street')
  s=Service(self.q,ROOT);s.model={'provider':'offline','model':'offline'};s.operator.lookup=lambda _:dict(status='not_found')
  with patch.object(s,'start_pi',side_effect=AssertionError('must not call model')):s.process_one()
  self.assertEqual(self.q.jobs()[0]['attempt'],1);self.assertEqual(len(list(self.q.db.execute('select * from attempts'))),1)
 def test_actual_tool_access_error_keeps_retry_and_max_three(self):
  self.result['tool_errors']=[{'tool':'content_search_poi','error_code':'public_http_403'}];self.advance()
  self.assertGreater(self.q.jobs()[0]['next_retry_at'],0);self.assertEqual(self.q.get('verification:'+self.job['id'])['retry_policy']['action'],'retry_transient')
  self.q.db.execute("update jobs set stage='failed',attempt=3,next_retry_at=0")
  self.assertIsNone(self.q.claim('next'));self.assertEqual(self.q.jobs()[0]['stage'],'failed')
 def test_model_word_alone_or_no_successful_settled_cannot_hold(self):
  for key,value in [('settled',{'aborted':True}),('tool_errors',None)]:
   original=copy.deepcopy(self.result);self.result[key]=value;self.advance()
   self.assertGreater(self.q.jobs()[0]['next_retry_at'],0);self.result=original
 def test_damaged_bytes_or_wrong_author_never_hold(self):
  self.add('metadata','metadata',{'code':0,'data':{'bvid':self.job['bvid'],'owner':{'mid':999},'desc':'-','pages':[{'page':1,'cid':5}]}})
  self.advance();self.assertGreater(self.q.jobs()[0]['next_retry_at'],0)
  self.add('metadata','metadata',{'code':0,'data':{'bvid':self.job['bvid'],'owner':{'mid':123},'desc':'-','pages':[{'page':1,'cid':5}]}})
  (Path(self.ctx['root'])/'frame.png').write_bytes(b'corrupt');self.advance();self.assertGreater(self.q.jobs()[0]['next_retry_at'],0)
 def test_new_evidence_requires_explicit_review_and_same_hash_does_not_requeue(self):
  self.advance();before=self.q.jobs()[0];fingerprint=self.q.get('verification:'+before['id'])['retry_policy']['evidence_sha256']
  self.advance();self.assertEqual(self.q.jobs()[0],before)
  self.add('metadata','metadata',{'code':0,'data':{'bvid':self.job['bvid'],'owner':{'mid':123},'desc':'测试店在测试路','pages':[{'page':1,'cid':5}]}})
  from foodmap_agent.retry_policy import review_policy
  policy=review_policy(self.job,self.result,self.ctx,self.verified,self.p._read)
  self.assertNotEqual(fingerprint,policy['evidence_sha256']);self.assertEqual(self.q.jobs()[0],before)

 def test_fixed_tool_outcomes_not_model_missing_words_determine_access_failure(self):
  from foodmap_agent.retry_policy import tool_error
  for result in [dict(status='pending_transport',error_code='public_http_403'),dict(status='blocked_capture',error_code='stream_unavailable')]:
   event=dict(toolName='content_capture_frame',result={'content':[{'type':'text','text':json.dumps(result)}]})
   self.assertIsNotNone(tool_error(event))
  self.assertIsNone(tool_error(dict(toolName='content_submit_extraction',isError=True,result={})))
  self.assertIsNone(tool_error(dict(toolName='content_capture_frame',result={'content':[{'type':'text','text':'{"status":"pending_budget"}'}]})))
 def test_foreign_source_and_ocr_address_are_not_machine_absence(self):
  self.ctx['evidence']['metadata']['source_url']='https://example.org/view';self.advance()
  self.assertGreater(self.q.jobs()[0]['next_retry_at'],0)
  self.ctx['evidence']['metadata']['source_url']='https://api.bilibili.com/x/web-interface/view'
  sha=next(iter(self.ctx['frame_files']))
  self.add('ocr:1','branch',dict(bvid=self.job['bvid'],part=1,cid=5,engine='apple-vision-v1',image_sha256=sha,lines=[dict(text='测试路1号',confidence=0.95)]))
  self.advance();self.assertGreater(self.q.jobs()[0]['next_retry_at'],0)

 def test_same_street_multiple_official_map_branches_stay_pending_until_new_proof(self):
  self.add('metadata','metadata',{'code':0,'data':{'bvid':self.job['bvid'],'owner':{'mid':123},'desc':'测试店在测试街','pages':[{'page':1,'cid':5}]}})
  self.result['proposal']['visits']=[{'store_name':'测试店'}]
  self.add('poi:1','poi',{'status':'1','pois':[{'id':'one','name':'测试店（甲店）','cityname':'北京市','adname':'东城区','address':'测试街1号'},{'id':'two','name':'测试店（乙店）','cityname':'北京市','adname':'东城区','address':'测试街2号'}]})
  self.advance();self.assertEqual(self.q.jobs()[0]['next_retry_at'],0)
  self.assertEqual(self.q.get('verification:'+self.job['id'])['retry_policy']['reason'],'ambiguous_amap_street_match')
