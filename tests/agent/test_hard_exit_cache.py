"""Isolated hard-exit recovery with real file registration, no provider/network."""
import hashlib,json,subprocess,sys,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
from foodmap_agent.queue import Store
from foodmap_agent.service import Service
ROOT=Path(__file__).resolve().parents[2]
CHILD=r'''
import json,os,sys,subprocess
from pathlib import Path
from foodmap_agent.queue import Store
from foodmap_agent.service import Service
root=Path(sys.argv[1]);q=Store(sys.argv[2]);s=Service(q,root);s.model={'provider':'fixture','model':'fixture'};s.operator.lookup=lambda _:dict(status='not_found')
class Pi:
 def run(self,job,context,**kw):
  session=q.root/'pi/sessions/fixture.jsonl';session.parent.mkdir(parents=True);session.write_text('fixture session\n')
  kw['on_bound'](dict(sessionFile=str(session),sessionId='00000000-0000-4000-8000-000000000001'))
  context['prompt']={'instruction':'OLD PROMPT MUST NOT BE RESTORED'}
  js='import fs from "node:fs/promises";import {register} from '+json.dumps((root/'agent/pi/adapters.mjs').as_uri())+';const c='+json.dumps(context)+';'
  js+='await register(c,"metadata","metadata",{code:0,data:{bvid:c.bvid,owner:{mid:123},pages:[{page:1,cid:123,duration:60}]}},"https://api.bilibili.com/x/web-interface/view?bvid="+c.bvid);'
  js+='const {createRequire}=await import("node:module");const {png,sha}=createRequire('+json.dumps((root/'package.json').as_uri())+')('+json.dumps(str(root/'tests/fixtures/publication.cjs'))+');const bytes=png(),hash=sha(bytes),name="frame-"+hash+".png";await fs.writeFile(c.root+"/"+name,bytes);c.frame_files={[hash]:{file:name,sha256:hash}};c.model_preview_bytes=123;'
  js+='await register(c,"frame:2000","frame",{bvid:c.bvid,part:1,cid:123,timestamp_ms:2000,actual_timestamp_ms:2000,sha256:hash,bytes:bytes.length,mime_type:"image/png",width:64,height:64,mean:120,stddev:40,capture_method:"official-stream-pipe"},"https://www.bilibili.com/video/"+c.bvid+"/");'
  js+='await fs.writeFile('+json.dumps(str(q.root/'pi/task.json'))+',JSON.stringify(c));'
  subprocess.run([str(root/'tools/node-v22.23.5-darwin-arm64/bin/node'),'--input-type=module','-e',js],cwd=root,check=True)
  os._exit(73)
 def close(self):pass
s.pi=Pi();s.start_pi=lambda:None;s.process_one()
'''
class HardExitCache(unittest.TestCase):
 def test_checkpoint_rejects_foreign_identity_corruption_and_symlink_and_ignores_prompt(self):
  from foodmap_agent.evidence_cache import recover_registered
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp).resolve();context=dict(task_id=str(uuid.uuid4()),creator_uid='123',bvid='BV1NG6kYTEXG',part=1,root=str(root))
   raw=json.dumps(dict(code=0,data=dict(bvid=context['bvid'],owner=dict(mid=123),pages=[dict(page=1,cid=123)]))).encode();digest=hashlib.sha256(raw).hexdigest();source=root/('source-'+digest+'.json');source.write_bytes(raw)
   good=dict(schema_version=1,**context,evidence={'metadata':dict(file=source.name,sha256=digest,kind='metadata')},frame_files={},model_preview_bytes=123,prompt={'instruction':'MUST NOT RETURN'},proposal_submitted=True,attempt=0)
   checkpoint=root/'registered-context.json'
   save=lambda value:checkpoint.write_text(json.dumps(value))
   save(good);restored=recover_registered(context);self.assertEqual(set(restored),{'evidence','frame_files','model_preview_bytes'});self.assertEqual(restored['model_preview_bytes'],123)
   for key in ('task_id','creator_uid','bvid','part','root'):
    with self.subTest(key=key):
     bad={**good,key:2 if key=='part' else 'wrong'};save(bad)
     with self.assertRaises(ValueError):recover_registered(context)
   save(good);source.write_bytes(raw+b' ')
   with self.assertRaises(ValueError):recover_registered(context)
   source.unlink();outside=root/'outside.json';outside.write_bytes(raw);source.symlink_to(outside)
   with self.assertRaises(ValueError):recover_registered(context)
   source.unlink();source.write_bytes(raw);checkpoint.unlink();checkpoint.symlink_to(outside)
   with self.assertRaises(ValueError):recover_registered(context)
   checkpoint.unlink();bad_raw=raw.replace(b'123',b'999');bad_hash=hashlib.sha256(bad_raw).hexdigest();bad_file=root/('source-'+bad_hash+'.json');bad_file.write_bytes(bad_raw)
   save({**good,'evidence':{'metadata':dict(file=bad_file.name,sha256=bad_hash,kind='metadata')}})
   with self.assertRaises(ValueError):recover_registered(context)
 def test_hard_exit_restores_registered_metadata_without_resetting_business_state(self):
  with tempfile.TemporaryDirectory() as tmp:
   q=Store(tmp);q.discover('123','BV1NG6kYTEXG',1,'old-source','old-title',1);job=q.jobs()[0]
   cursor=dict(page=3,next_retry_at=123,failures=1);q.save_cursor('fixture-source',cursor)
   rid=str(uuid.uuid4());q.prepare(rid,dict(operation='fixture'));q.finish_receipt(rid,dict(status='committed',request_id=rid));q.close()
   child=subprocess.run([sys.executable,'-c',CHILD,str(ROOT),tmp],cwd=ROOT,capture_output=True,text=True)
   self.assertEqual(child.returncode,73,child.stderr)
   q=Store(tmp);self.addCleanup(q.close);self.assertEqual(q.jobs()[0]['attempt'],1)
   durable=json.loads((q.root/'pi/task.json').read_text());self.assertIn('metadata',durable['evidence'])
   self.assertIsNone(q.get('task_context:'+job['id']))
   # Isolated simulated lease expiry only; no production flags or clock changes.
   q.db.execute('update jobs set lease_until=0 where id=?',(job['id'],));q.recover(lambda _:dict(status='not_found'))
   q.discover('123','BV1NG6kYTEXG',1,'new-source','new-title',2)
   s=Service(q,ROOT);s.model={'provider':'fixture','model':'fixture'};s.operator.lookup=lambda _:dict(status='not_found');seen=[]
   class Pi:
    def run(self,job,context,**kw):seen.append(context.copy());raise TimeoutError()
    def close(self):pass
   s.pi=Pi()
   with patch.object(s,'start_pi'):s.process_one()
   self.assertIn('metadata',seen[0]['evidence'])
   self.assertEqual(seen[0]['evidence']['metadata'],durable['evidence']['metadata'])
   self.assertEqual(seen[0]['frame_files'],durable['frame_files']);self.assertEqual(seen[0]['model_preview_bytes'],123)
   self.assertNotIn('OLD PROMPT',seen[0]['prompt']['instruction'])
   actual=hashlib.sha256((Path(seen[0]['root'])/'discovery.json').read_bytes()).hexdigest()
   self.assertEqual(actual,seen[0]['evidence']['discovery']['sha256'])
   self.assertEqual(q.jobs()[0]['attempt'],2);self.assertEqual(q.db.execute('select count(*) from attempts').fetchone()[0],2)
   self.assertEqual(q.jobs()[0]['session_id'],'00000000-0000-4000-8000-000000000001')
   self.assertEqual(q.cursor('fixture-source')['page'],3);self.assertEqual(q.receipts()[0]['status'],'committed')
