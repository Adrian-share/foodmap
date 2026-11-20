"""Offline data-version identity changes and deterministic retry; no real publication."""
import base64,json,subprocess,tempfile,unittest
from pathlib import Path
from foodmap_agent.queue import Store
from foodmap_agent.publisher import Publisher
ROOT=Path(__file__).resolve().parents[2]
class StoreIdentity(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.q=Store(t.name);self.addCleanup(self.q.close);self.q.seed(ROOT)
  self.p=subprocess.Popen([str(ROOT/'tools/node-v22.23.5-darwin-arm64/bin/node'),'tests/fixtures/identity-rpc.cjs'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
  self.addCleanup(self.close_rpc);self.calls=[]
  self.f=self.request({'fixture':True});self.aliases=self.f.pop('aliases');self.proofs=self.f.pop('proofs')
  for d in self.f['documents']:d['bytes']=base64.b64decode(d.pop('data'))
  for i in self.f['images']:i['data']=base64.b64decode(i['data'])
  self.args=dict(source_commit='a'*40,registry_revision=1,baseline_version=self.q.get('baseline')['version'])
 def close_rpc(self):
  self.p.stdin.close();self.p.wait(timeout=10);self.p.stdout.close()
 def request(self,body):
  self.p.stdin.write(json.dumps(body)+'\n');self.p.stdin.flush();x=json.loads(self.p.stdout.readline())
  if x.get('transport_error'):raise RuntimeError(x['transport_error'])
  return x
 def operator(self,body):
  self.calls.append(body['operation'] if body else 'GET');return self.request(body)
 def test_unknown_mapping_does_not_freeze_a_permanently_unpublishable_plan(self):
  p=Publisher(self.q,self.operator)
  from foodmap_agent.publisher import IdentityPending
  with self.assertRaises(IdentityPending) as caught:p.publish(**self.f,**self.args)
  self.assertTrue(any(r['reason']=='same_address_without_confirmed_identity' for r in caught.exception.pending[0]['relations']))
  self.assertEqual(self.q.get('publication_plans',{}),{});self.assertEqual(self.calls,['GET'])
  # Publish a real content-version identity change through the SAME publisher,
  # then admit the saved C2 result without another model attempt or second path.
  identity=p.publish([],[],[],store_aliases=self.aliases,store_alias_evidence=self.proofs,**self.args)
  accepted=p.publish(**self.f,**self.args);self.assertEqual(accepted['status'],'committed')
  parent=self.q.get('publication_manifests')[accepted['data_version']];self.assertEqual(parent['store_aliases'],self.aliases);self.assertEqual(parent['parent_version'],identity['data_version'])
  self.assertEqual(self.q.db.execute('select count(*) from attempts').fetchone()[0],0)
 def test_identity_only_change_with_same_verification_set_gets_distinct_plan_and_retry_reuses_exact_version(self):
  p=Publisher(self.q,self.operator)
  a=p.publish([],[],[],**self.args)
  b=p.publish([],[],[],store_aliases=self.aliases,store_alias_evidence=self.proofs,**self.args)
  self.assertNotEqual(a['data_version'],b['data_version']);before=self.calls.count('release.commit')
  again=p.publish([],[],[],store_aliases=self.aliases,store_alias_evidence=self.proofs,**self.args)
  self.assertEqual(again['data_version'],b['data_version']);self.assertEqual(self.calls.count('release.commit'),before)
 def test_saved_c2_reenters_same_pipeline_only_after_identity_content_version_changes(self):
  from foodmap_agent.service import Service
  from foodmap_agent.pipeline import Pipeline
  from unittest.mock import patch
  self.q.discover('544336675','BV1abcde2345',1,'offline','fixture',1);job=self.q.claim('owner');self.q.release(job['id'],'owner','verifying')
  self.q.set('watchlist',dict(registry_revision=1));f=self.f;directory=self.q.root/'evidence'/job['id'];directory.mkdir(parents=True)
  frames={}
  for image in f['images']:
   name=image['sha256']+'.png';(directory/name).write_bytes(image['data']);frames[image['sha256']]=dict(file=name,sha256=image['sha256'])
  self.q.set('publish:'+job['id'],dict(records=f['records'],documents=[dict(sha256=d['sha256'],bytes_base64=base64.b64encode(d['bytes']).decode()) for d in f['documents']],images=[{k:v for k,v in i.items() if k!='data'} for i in f['images']],context={'root':str(directory),'frame_files':frames}))
  pipeline=Pipeline(self.q,ROOT,ROOT/'tools/node-v22.23.5-darwin-arm64/bin/node',self.operator,'a'*40)
  self.assertIsNone(pipeline.resume(job));self.assertEqual(self.q.jobs()[0]['stage'],'pending');self.assertEqual(self.q.jobs()[0]['error_code'],'store_identity_unresolved')
  service=Service(self.q,ROOT,mode='production');service.pipeline=pipeline
  with patch.object(service,'start_pi',side_effect=AssertionError('identity review must not call model')):
   self.assertFalse(service.advance_pipeline())
   identity=pipeline.publisher.publish([],[],[],store_aliases=self.aliases,store_alias_evidence=self.proofs,**self.args)
   self.assertTrue(service.advance_pipeline());self.assertEqual(self.q.jobs()[0]['stage'],'published')
  self.assertEqual(self.q.jobs()[0]['attempt'],1);self.assertEqual(self.q.db.execute('select count(*) from attempts').fetchone()[0],1)

 def branch_fixture(self, **overrides):
  options=dict(poi='OFFLINE_TONGZHOU',branchName='通州店',address='滨河路52号',district='通州区',gcj02=dict(lng=116.65,lat=39.91),officialDescription=True)
  options.update(overrides);f=self.request(dict(fixture=True,options=options));f.pop('aliases');f.pop('proofs')
  for d in f['documents']:d['bytes']=base64.b64decode(d.pop('data'))
  for i in f['images']:i['data']=base64.b64decode(i['data'])
  return f
 def test_distinct_approved_branch_publishes_without_waiting_for_legacy_mapping(self):
  f=self.branch_fixture();self.assertEqual(f['records'][0]['review']['rules_version'],'v2')
  receipt=Publisher(self.q,self.operator).publish(**f,**self.args)
  self.assertEqual(receipt['status'],'committed');manifest=self.q.get('publication_manifests')[receipt['data_version']]
  self.assertEqual(manifest['store_aliases'],{});self.assertEqual(manifest['records'][0]['visit']['store_id'],'amap:OFFLINE_TONGZHOU')
  self.assertEqual(self.q.db.execute('select count(*) from attempts').fetchone()[0],0)
 def test_original_poi_parent_category_stays_pending_before_plan_or_upload(self):
  from foodmap_agent.publisher import IdentityPending
  f=self.branch_fixture(poiType='140000',poiName='泰丰楼文化中心(通州店)')
  with self.assertRaises(IdentityPending):Publisher(self.q,self.operator).publish(**f,**self.args)
  self.assertEqual(self.q.get('publication_plans',{}),{});self.assertEqual(self.calls,['GET'])
  self.assertEqual(self.q.db.execute('select count(*) from attempts').fetchone()[0],0)
