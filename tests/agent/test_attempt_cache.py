import unittest,tempfile,json,time,hashlib
from pathlib import Path
from unittest.mock import patch
from foodmap_agent.queue import Store
from foodmap_agent.service import Service
from foodmap_agent.pi_rpc import PiRPC,ProtocolError
ROOT=Path(__file__).resolve().parents[2]
class AttemptCache(unittest.TestCase):
 def test_cached_context_identity_mismatch_never_reaches_model_or_overwrites_cache(self):
  for key in ('task_id','creator_uid','bvid','part','root'):
   with self.subTest(key=key),tempfile.TemporaryDirectory() as tmp:
    q=Store(tmp);self.addCleanup(q.close);q.discover('123','BV1NG6kYTEXG',1,'offline','offline',1);job=q.jobs()[0]
    s=Service(q,ROOT);s.model={'provider':'offline','model':'offline'};s.operator.lookup=lambda _:dict(status='not_found')
    saved=dict(task_id=job['id'],creator_uid='123',bvid=job['bvid'],part=1,root=str(Path(tmp)/'evidence'/job['id']),evidence={})
    saved[key]=2 if key=='part' else 'wrong';q.set('task_context:'+job['id'],saved)
    called=[]
    class Pi:
     def run(self,*_,**kw):called.append(True);raise AssertionError('mismatched task must not reach model')
     def close(self):pass
    s.pi=Pi()
    with patch.object(s,'start_pi'):s.process_one()
    self.assertEqual(called,[]);self.assertEqual(q.jobs()[0]['attempt'],1);self.assertNotEqual(q.jobs()[0]['stage'],'verifying')
    self.assertEqual(q.get('task_context:'+job['id']),saved)
 def test_retry_after_discovery_update_binds_current_bytes_and_keeps_cache(self):
  with tempfile.TemporaryDirectory() as tmp:
   q=Store(tmp);self.addCleanup(q.close);q.discover('123','BV1NG6kYTEXG',1,'old-source','old-title',1);job=q.jobs()[0]
   s=Service(q,ROOT);s.model={'provider':'offline','model':'offline'};s.operator.lookup=lambda _:dict(status='not_found');checks=[]
   class Pi:
    def run(self,job,context,**kw):
     actual=hashlib.sha256((Path(context['root'])/'discovery.json').read_bytes()).hexdigest()
     checks.append((actual==context['evidence']['discovery']['sha256'],'frame:2000' in context['evidence']))
     context['evidence']['frame:2000']={'file':'registered-frame.json','sha256':'a'*64}
     raise TimeoutError()
    def close(self):pass
   s.pi=Pi()
   with patch.object(s,'start_pi'):
    s.process_one();q.discover('123','BV1NG6kYTEXG',1,'new-source','new-title',2)
    q.db.execute('update jobs set next_retry_at=0 where id=?',(job['id'],));s.process_one()
   self.assertEqual(checks,[(True,False),(True,True)])
   self.assertEqual(q.jobs()[0]['attempt'],2)
 def test_timeout_keeps_registered_context_for_same_job_retry(self):
  with tempfile.TemporaryDirectory() as tmp:
   q=Store(tmp);self.addCleanup(q.close);q.discover('123','BV1NG6kYTEXG',1,'offline','offline',1);job=q.jobs()[0]
   s=Service(q,ROOT);s.model={'provider':'offline','model':'offline'};s.operator.lookup=lambda _:dict(status='not_found')
   seen=[]
   class Pi:
    def run(self,job,context,**kw):seen.append(dict(context['evidence']));context['evidence']['frame:2000']={'file':'frame-source.json','sha256':'a'*64};raise TimeoutError()
    def close(self):pass
   s.pi=Pi()
   with patch.object(s,'start_pi'):
    s.process_one();self.assertIn('frame:2000',q.get('task_context:'+job['id'],{}).get('evidence',{}))
    q.db.execute("update jobs set stage='discovered',next_retry_at=0 where id=?",(job['id'],));s.process_one()
   self.assertIn('frame:2000',seen[1]);self.assertEqual(q.jobs()[0]['attempt'],2)
 def test_rpc_context_identity_guard_and_progress_copy(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'task.json';rpc=object.__new__(PiRPC);rpc.task_file=p
   context=dict(task_id='id',creator_uid='123',bvid='BV1NG6kYTEXG',part=1,root=tmp,evidence={})
   p.write_text(json.dumps({**context,'evidence':{'frame:2':{'sha256':'a'*64}},'frame_capture_count':3}))
   rpc.sync_context(context);self.assertIn('frame:2',context['evidence']);self.assertEqual(context['frame_capture_count'],3)
   p.write_text(json.dumps({**context,'creator_uid':'999'}))
   with self.assertRaises(ProtocolError):rpc.sync_context(context)
 def test_production_restart_preserves_future_natural_timers(self):
  with tempfile.TemporaryDirectory() as tmp:
   q=Store(tmp);self.addCleanup(q.close);a=time.time()+900;b=time.time()+3600
   q.set('service',dict(mode='production',next_watchlist_at=a,next_source_at=b))
   s=Service(q,ROOT,mode='production');self.assertEqual(s.next_watchlist_at,a);self.assertEqual(s.next_source_at,b)
