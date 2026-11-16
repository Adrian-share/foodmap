import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from foodmap_agent.pi_rpc import PiRPC

class ProcessGroup(unittest.TestCase):
    def test_close_reaps_own_adapter_group_even_if_child_ignores_term(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
            marker = Path(tmp) / 'child.json'
            script = 'import subprocess,sys,time,json;from pathlib import Path;p=subprocess.Popen([sys.executable,"-c","import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"]);Path(sys.argv[1]).write_text(json.dumps({"pid":p.pid}));time.sleep(60)'
            proc = subprocess.Popen([sys.executable,'-c',script,str(marker)],start_new_session=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            deadline = time.monotonic()+5
            while not marker.exists() and time.monotonic()<deadline:
                time.sleep(.02)
            self.assertTrue(marker.exists())
            child = json.loads(marker.read_text())['pid']
            rpc = PiRPC.__new__(PiRPC)
            rpc.proc, rpc.closed, rpc.threads = proc, False, []
            try:
                time.sleep(.1)
                rpc.close()
                deadline = time.monotonic()+3
                while time.monotonic()<deadline:
                    result = subprocess.run(['ps','-o','stat=','-p',str(child)],capture_output=True,text=True)
                    if not result.stdout.strip() or result.stdout.strip().startswith('Z'):
                        break
                    time.sleep(.05)
                self.assertTrue(not result.stdout.strip() or result.stdout.strip().startswith('Z'), 'adapter child still running')
            finally:
                # Exact owned group cleanup for a failing implementation.
                try:os.killpg(proc.pid,9)
                except ProcessLookupError:pass
                proc.wait(timeout=5)
