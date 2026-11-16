from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from foodmap_agent.queue import Store
from foodmap_agent.service import Service

ROOT=Path(__file__).resolve().parents[2]
class ServiceHealth(unittest.TestCase):
    def test_restart_failures_back_off_without_queue_or_model_activity(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'tests/agent') as tmp:
            q=Store(tmp);self.addCleanup(q.close)
            s=Service(q,ROOT)
            with patch.object(s,'start_pi',side_effect=RuntimeError('fixture failure')) as start:
                s.ensure_pi();s.ensure_pi()
                self.assertEqual(start.call_count,1)
            self.assertEqual(s.last_error,'pi_restart_backoff')
            self.assertGreater(s.pi_restart_at,__import__('time').time())
            self.assertEqual(q.jobs(),[])
            self.assertEqual(q.cursors(),[])
            s.heartbeat();self.assertEqual(q.get('service')['model_requests'],0)

    @unittest.skipUnless(Path('/usr/bin/python3').exists(),'Mac system Python required')
    def test_old_python_rejected_before_touching_existing_venv(self):
        old=subprocess.check_output(['/usr/bin/python3','-c','import sys;print(sys.version_info< (3,12))'],text=True).strip()
        if old!='True':self.skipTest('system Python is not old')
        cfg=ROOT/'tools/venv/pyvenv.cfg'
        before=(cfg.read_bytes(),cfg.stat().st_mtime_ns)
        result=subprocess.run(['/usr/bin/python3',str(ROOT/'deployment/foodmap-agent/install.py')],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('Python >=3.12 required',result.stderr)
        self.assertEqual(before,(cfg.read_bytes(),cfg.stat().st_mtime_ns))
