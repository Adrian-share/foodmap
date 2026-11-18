"""Guard tests only; never send signals or claim a production P3 pass."""
import json,tempfile,unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from foodmap_agent.p3_acceptance import P3Acceptance,fault_ready
from foodmap_agent.queue import Store
class P3ObserverGuards(unittest.TestCase):
 def test_only_first_attempt_then_same_second_attempt_with_future_budget_are_eligible(self):
  good=dict(stage='cleaning',attempt=1,lease_owner='owner',lease_until=200)
  s=dict(instance_id='owner',scheduler_owner='python',mode='production')
  self.assertTrue(fault_ready(good,s,1,True,100,False))
  self.assertFalse(fault_ready({**good,'attempt':2},s,1,True,100,False))
  self.assertTrue(fault_ready({**good,'attempt':2},s,8,True,100,True))
  for job,used,registered in [({**good,'attempt':3},8,True),({**good,'attempt':2},10,True),({**good,'attempt':2},8,False),({**good,'attempt':2,'lease_owner':'other'},8,True)]:
   self.assertFalse(fault_ready(job,s,used,registered,100,True))

class P3CursorEvidence(unittest.TestCase):
 def setUp(self):
  tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);self.state=Path(tmp.name)
  self.store=Store(self.state);self.addCleanup(self.store.close)
  (self.state/'pi').mkdir();(self.state/'pi/model-audit.jsonl.count.json').write_text('{"provider_requests":74}')
  self.observer=P3Acceptance(self.state,self.state/'acceptance/test','a'*40,'unused-cli')
  self.key='123:collection:456:1:anchor:BV1NG6kYTEXG'
  self.cursor=dict(page=2,source=dict(uid='123',type='collection',id='456',anchor_bvid='BV1NG6kYTEXG'),
                   last_success=dict(at='2026-11-18T05:00:00Z',page=1,obtained=100),
                   checked_at='2026-11-18T05:00:00Z',next_retry_at=1795041000,failures=2,error_code='official_source_restricted')
  self.store.save_cursor(self.key,self.cursor)
 def test_snapshot_records_complete_cursor_json_and_checked_at_without_writes(self):
  before=list(self.store.db.iterdump());s=self.observer.snapshot()
  self.assertEqual(s['cursor_values'],{self.key:self.cursor})
  self.assertIsNotNone(datetime.fromisoformat(s['checked_at'].replace('Z','+00:00')).tzinfo)
  self.assertEqual(s['cursors'],[self.key]);self.assertEqual(list(self.store.db.iterdump()),before)
  self.assertFalse(self.observer.file.exists())
 def test_same_keys_do_not_hide_cleared_values_and_missing_keys(self):
  before=self.observer.snapshot();self.store.save_cursor(self.key,dict(page=1,next_retry_at=0,last_success=None,failures=0))
  after=self.observer.snapshot();comparison=self.observer.cursor_comparison(before,after)
  self.assertEqual(before['cursors'],after['cursors'])
  self.assertEqual(comparison['status'],'pending_source_progress_review')
  self.assertEqual(comparison['changed'][self.key],dict(before=self.cursor,after=after['cursor_values'][self.key]))
  self.store.db.execute('delete from source_cursors');missing=self.observer.cursor_comparison(before,self.observer.snapshot())
  self.assertEqual(missing['missing'],[self.key]);self.assertEqual(missing['status'],'missing_cursor_values')
 def test_natural_progress_is_saved_separately_for_review_not_automatically_failed(self):
  before=self.observer.snapshot();advanced={**self.cursor,'page':3,'next_retry_at':0,'failures':0,
   'last_success':dict(at='2026-11-18T05:16:12Z',page=2,obtained=100),'checked_at':'2026-11-18T05:16:12Z'}
  scan=dict(checked_at='2026-11-18T05:16:12Z',ok=1,failed=0)
  self.store.save_cursor(self.key,advanced);self.store.set('last_scan',scan)
  after=self.observer.snapshot();comparison=self.observer.cursor_comparison(before,after)
  self.assertEqual(comparison['status'],'pending_source_progress_review')
  self.assertEqual(comparison['changed'][self.key]['after'],advanced)
  self.assertEqual(after['last_scan'],scan);self.assertEqual(comparison['after_checked_at'],after['checked_at'])
  unchanged=self.observer.cursor_comparison(after,self.observer.snapshot())
  self.assertEqual(unchanged['status'],'unchanged');self.assertEqual(unchanged['unchanged'],[self.key])
 def test_old_key_only_snapshot_cannot_be_treated_as_full_value_evidence(self):
  before=self.observer.snapshot();del before['cursor_values']
  self.assertEqual(self.observer.cursor_comparison(before,self.observer.snapshot())['status'],'missing_cursor_snapshot')
 def test_first_fault_journals_fresh_cursor_values_before_mocked_signal(self):
  job=dict(id='task',bvid='BV1NG6kYTEXG',uid='123',part=1,stage='cleaning',attempt=1,
           lease_owner='owner',lease_until=10**12,session_id='session',session_path='session.jsonl')
  service=dict(instance_id='owner',scheduler_owner='python',mode='production',pid=12345,pi=dict(pid=12346))
  stale={**self.observer.snapshot(),'jobs':[job],'service':service}
  self.store.save_cursor(self.key,{**self.cursor,'page':3});fresh={**self.observer.snapshot(),'jobs':[job],'service':service}
  def sent(*_):
   saved=json.loads(self.observer.file.read_text());self.assertEqual(saved['baseline']['cursor_values'],fresh['cursor_values'])
   self.assertEqual(saved['baseline']['checked_at'],fresh['checked_at'])
  with patch.object(self.observer,'legacy_stopped'),patch.object(self.observer,'owned'),patch.object(self.observer,'registered',return_value=True),patch.object(self.observer,'snapshot',return_value=fresh),patch('foodmap_agent.p3_acceptance.os.killpg',side_effect=sent) as signal:
   self.assertTrue(self.observer.interrupt(stale,job,{},False));signal.assert_called_once()
 def test_launchd_recovery_persists_cursor_values_and_time_before_final_task_settles(self):
  baseline=self.observer.snapshot();self.observer.value.update(phase='waiting_restart',baseline=baseline,second_pi_pid=12346,second_python_pid=12345)
  recovered={**self.observer.snapshot(),'service':dict(pid=12347,pi=dict(pid=12348))}
  with patch.object(self.observer,'snapshot',return_value=recovered),patch.object(self.observer,'alive',return_value=False),patch.object(self.observer,'owned'):
   self.observer.tick()
  saved=json.loads(self.observer.file.read_text())
  self.assertEqual(saved['recovery_snapshot']['cursor_values'],baseline['cursor_values'])
  self.assertEqual(saved['recovery_snapshot']['checked_at'],recovered['checked_at'])
  self.assertEqual(saved['cursor_recovery_comparison']['status'],'unchanged')
  self.assertEqual(saved['phase'],'waiting_final')
 def test_final_snapshot_and_value_diff_survive_failed_settlement_check(self):
  baseline=self.observer.snapshot();self.store.save_cursor(self.key,dict(page=1,next_retry_at=0))
  final={**self.observer.snapshot(),'jobs':[dict(id='task',stage='failed')],'extraction':None}
  self.observer.value.update(phase='waiting_final',baseline=baseline,task_id='task')
  with patch.object(self.observer,'snapshot',return_value=final),self.assertRaisesRegex(RuntimeError,'final_task_has_no_successful_settled'):
   self.observer.tick()
  saved=json.loads(self.observer.file.read_text())
  self.assertEqual(saved['final_snapshot']['cursor_values'],final['cursor_values'])
  self.assertEqual(saved['cursor_final_comparison']['status'],'pending_source_progress_review')
 def test_each_fault_saves_actual_fresh_registration_before_mocked_signal(self):
  for second in (False,True):
   with self.subTest(second=second):
    self.observer.value.update(session_id='session')
    job=dict(id='task',bvid='BV1NG6kYTEXG',uid='123',part=1,stage='cleaning',attempt=2 if second else 1,
             lease_owner='owner',lease_until=10**12,session_id='session',session_path='session.jsonl')
    service=dict(instance_id='owner',scheduler_owner='python',mode='production',pid=12345,pi=dict(pid=12346))
    snap={**self.observer.snapshot(),'jobs':[job],'service':service}
    stale=dict(registered=dict(evidence={'metadata':'metadata'},frame_files={'old':'old'}))
    fresh=dict(identity=dict(task_id='task'),registered=dict(evidence={'metadata':'metadata'},frame_files={'old':'old','new':'new'}))
    def sent(*_):
     saved=json.loads(self.observer.file.read_text())
     self.assertEqual(saved['second_registration' if second else 'first_registration'],fresh)
    with patch.object(self.observer,'legacy_stopped'),patch.object(self.observer,'owned'),patch.object(self.observer,'registered',return_value=fresh),patch.object(self.observer,'snapshot',return_value=snap),patch('foodmap_agent.p3_acceptance.os.killpg',side_effect=sent),patch('foodmap_agent.p3_acceptance.os.kill',side_effect=sent):
     self.assertTrue(self.observer.interrupt(snap,job,stale,second))
 def test_final_recovery_checks_both_prefixes_and_rejects_new_second_frame_loss(self):
  first=dict(evidence={'metadata':{'sha256':'metadata'}},frame_files={'first':'sha-first'})
  second=dict(evidence=first['evidence'],frame_files={**first['frame_files'],'second':'sha-second'})
  self.observer.value.update(first_registration=dict(registered=first),second_registration=dict(registered=second))
  good=self.observer.registration_checks(second)
  self.assertTrue(all(good.values()))
  lost=self.observer.registration_checks(first)
  self.assertTrue(lost['first_original_frames_preserved']);self.assertFalse(lost['second_original_frames_preserved'])
  corrupt=self.observer.registration_checks({**second,'evidence':{'metadata':{'sha256':'changed'}}})
  self.assertFalse(corrupt['first_metadata_preserved']);self.assertFalse(corrupt['second_metadata_preserved'])
  del self.observer.value['second_registration']
  self.assertFalse(all(self.observer.registration_checks(second).values()))
 def test_final_tick_cannot_complete_when_only_second_prefix_frame_is_lost(self):
  first=dict(evidence={'metadata':{'sha256':'metadata'}},frame_files={'first':'sha-first'})
  second=dict(evidence=first['evidence'],frame_files={**first['frame_files'],'second':'sha-second'})
  baseline=self.observer.snapshot()
  job=dict(id='task',bvid='BV1NG6kYTEXG',part=1,rules_version='v1',stage='pending',attempt=3,session_id='session',session_path='session.jsonl')
  final={**baseline,'jobs':[job],'extraction':{'result':{'settled':{'aborted':False}}},'events':[{'stage':'pending'}]}
  self.observer.value.update(phase='waiting_final',task_id='task',baseline=baseline,session_id='session',session_path='session.jsonl',first_registration={'registered':first},second_registration={'registered':second})
  with patch.object(self.observer,'snapshot',return_value=final),patch.object(self.observer,'registered_final',return_value=first),self.assertRaisesRegex(RuntimeError,'second_original_frames_preserved'):
   self.observer.tick()
  saved=json.loads(self.observer.file.read_text())
  self.assertTrue(saved['checks']['first_original_frames_preserved']);self.assertFalse(saved['checks']['second_original_frames_preserved'])
  self.assertEqual(saved['final_registration'],first);self.assertEqual(saved['phase'],'waiting_final')
