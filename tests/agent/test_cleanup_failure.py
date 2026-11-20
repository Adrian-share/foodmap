import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from foodmap_agent.pi_rpc import PiRPC

class CleanupFailure(unittest.TestCase):
    def test_unrelated_cli_failure_timeout_or_non_json_never_leaks_owned_pi(self):
        for body in ('raise SystemExit(1)', 'import time;time.sleep(2)', 'print("not json")'):
            with self.subTest(body=body), tempfile.TemporaryDirectory(dir=Path(__file__).parent) as tmp:
                cli=Path(tmp)/'fake-multica'
                cli.write_text('#!'+sys.executable+'\n'+body+'\n');cli.chmod(0o700)
                proc=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                rpc=PiRPC.__new__(PiRPC);rpc.proc=proc;rpc.closed=False;rpc.threads=[]
                try:
                    with patch.dict(os.environ,{'MULTICA_CLI_PATH':str(cli)}):
                        rpc.close()
                        rpc.close()
                    self.assertIsNotNone(proc.poll())
                    self.assertTrue(proc.stdin.closed and proc.stdout.closed and proc.stderr.closed)
                finally:
                    if proc.poll() is None:os.killpg(proc.pid,9);proc.wait(timeout=5)
                    for stream in (proc.stdin,proc.stdout,proc.stderr):stream.close()
