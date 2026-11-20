"""Foreground diagnostic. No model work: this alone cannot satisfy P1/P2."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
state=root/'.agent-state/idle-probe'
command=[sys.executable,'-m','foodmap_agent','--state',str(state),'serve','--offline','--duration','610']
proc=subprocess.Popen(command,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
report={'scope':'real Pi control plane only; model unavailable; P1 after-task acceptance pending','samples':[]}
try:
    for index in range(21):
        if index:
            time.sleep(30)
        if proc.poll() is not None:
            raise RuntimeError('service_exited_early')
        if (state/'queue.sqlite3').exists():
            store=Store(state)
            sample=store.get('service')
            store.close()
            if sample:
                report['samples'].append(sample)
                print(json.dumps({'heartbeat_at':sample['heartbeat_at'],'python_pid':sample['pid'],'pi_pid':sample['pi']['pid'],'pi_state':sample['pi']['state'],'model_requests':sample['model_requests']}),flush=True)
    proc.wait(timeout=30)
    report['service_exit_code']=proc.returncode
finally:
    if proc.poll() is None:
        proc.terminate();proc.wait(timeout=15)
    report['finished_at']=time.time()
    (root/'evidence/FACT-32/real-idle-control.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    proc.stdout.close();proc.stderr.close()
