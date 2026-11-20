"""Explicit real-time windows; mocked signals, isolated state only."""
import json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from foodmap_agent.p3_acceptance import P3Acceptance

class ExplicitWindow(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.state=Path(self.tmp.name)
 def observer(self,**kw):
  return P3Acceptance(self.state,self.state/'acceptance/p3-20261121','a'*40,'unused',window_start='2026-11-21T00:00:00+08:00',window_end='2026-11-21T02:00:00+08:00',**kw)
 def test_future_window_waits_on_actual_epoch_without_reading_jobs_or_signalling(self):
  o=self.observer()
  with patch('foodmap_agent.p3_acceptance.time.time',return_value=1795190100),patch.object(o,'snapshot',side_effect=AssertionError('not due')),patch('foodmap_agent.p3_acceptance.os.kill') as kill,patch('foodmap_agent.p3_acceptance.os.killpg') as group:
   o.tick();self.assertEqual(o.value['phase'],'waiting_window');kill.assert_not_called();group.assert_not_called()
 def test_expired_has_no_signal_and_does_not_read_jobs(self):
  o=self.observer()
  with patch('foodmap_agent.p3_acceptance.time.time',return_value=1795197601),patch.object(o,'snapshot',side_effect=AssertionError('expired')),patch('foodmap_agent.p3_acceptance.os.kill') as kill,patch('foodmap_agent.p3_acceptance.os.killpg') as group:
   o.tick();self.assertEqual(o.value['phase'],'expired_pending');kill.assert_not_called();group.assert_not_called()
 def test_invalid_timezone_order_and_duration_rejected_without_journal(self):
  for start,end in [('2026-11-21T00:00:00','2026-11-21T02:00:00+08:00'),('2026-11-21T00:00:00+08:00','2026-11-21T00:00:00+08:00'),('2026-11-21T02:00:00+08:00','2026-11-21T00:00:00+08:00'),('2026-11-21T00:00:00+08:00','2026-11-21T02:00:01+08:00')]:
   with self.subTest(start=start,end=end),self.assertRaises(ValueError):P3Acceptance(self.state,self.state/'acceptance/bad','a'*40,'unused',window_start=start,window_end=end)
  self.assertFalse((self.state/'acceptance/bad/status.json').exists())
 def test_reopen_changed_window_or_release_preserves_exact_journal(self):
  o=self.observer();o.save('fixture_preflight');before=o.file.read_bytes()
  for release,start,end in [('b'*40,'2026-11-21T00:00:00+08:00','2026-11-21T02:00:00+08:00'),('a'*40,'2026-11-21T00:01:00+08:00','2026-11-21T02:00:00+08:00')]:
   with self.assertRaises(ValueError):P3Acceptance(self.state,o.journal,release,'unused',window_start=start,window_end=end)
   self.assertEqual(o.file.read_bytes(),before)
  self.assertEqual(self.observer().value['window'],o.value['window'])
 def test_no_candidate_and_budget_do_not_signal(self):
  for used,expected in [(0,'waiting_window'),(10,'budget_exhausted_pending')]:
   o=self.observer()
   with patch('foodmap_agent.p3_acceptance.time.time',return_value=1795190401),patch.object(o,'snapshot',return_value=dict(used=used,jobs=[])),patch('foodmap_agent.p3_acceptance.os.kill') as k,patch('foodmap_agent.p3_acceptance.os.killpg') as g:
    o.tick();self.assertEqual(o.value['phase'],expected);k.assert_not_called();g.assert_not_called()
