"""Real idle Pi crash: Python must restart it without any model request."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
parser=argparse.ArgumentParser();parser.add_argument('--deadline',type=float,default=30);parser.add_argument('--label',default='green');args=parser.parse_args()
state=root/('.agent-state/idle-restart-'+args.label)
command=[sys.executable,'-m','foodmap_agent','--state',str(state),'--model-config','/Users/adrian/foodmap-agent-state/pi/model-private.json','serve','--offline']
proc=subprocess.Popen(command,cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
report={'scope':'isolated real configured Pi idle crash; no jobs or model prompts'}
def snapshot():
    if not (state/'queue.sqlite3').exists():return None
    q=Store(state)
    result={'service':q.get('service'),'jobs':q.jobs(),'cursors':q.cursors(),'videos':len(q.videos())}
    q.close();return result if result['service'] else None
try:
    end=time.monotonic()+15
    before=None
    while time.monotonic()<end:
        before=snapshot()
        if before and before['service']['pi']['state']=='idle':break
        time.sleep(.1)
    assert before and before['service']['pi']['state']=='idle'
    report['before']=before
    pid=before['service']['pi']['pid']
    daemon=json.loads(subprocess.check_output([os.environ['MULTICA_CLI_PATH'],'daemon','status','--output','json'],text=True))['pid']
    assert pid!=daemon and os.getpgid(pid)==pid
    started=time.monotonic();os.killpg(pid,signal.SIGKILL)
    end=started+args.deadline
    after=None
    while time.monotonic()<end:
        after=snapshot()
        if after and after['service']['pi']['pid']!=pid and after['service']['pi']['state']=='idle':break
        time.sleep(.2)
    report['after']=after;report['recovery_seconds']=time.monotonic()-started
    report['passed']=bool(after and after['service']['pi']['pid']!=pid and after['service']['pi']['state']=='idle')
    if report['passed']:
        assert after['service']['pid']==before['service']['pid']
        assert after['jobs']==before['jobs'] and after['cursors']==before['cursors'] and after['videos']==before['videos']
        assert after['service']['model_requests']==0
        report['audit']=json.loads((state/'pi/audit.json').read_text())
        assert report['audit']['valid']
finally:
    proc.terminate();proc.wait(timeout=15)
    (root/f'evidence/FACT-32/{args.label}-idle-restart.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed',False),'recovery_seconds':report.get('recovery_seconds')}))
if not report.get('passed'):sys.exit(1)
