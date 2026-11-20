"""Destructive recovery test confined to .agent-state/recovery-probe."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.service import Service, Singleton

state=root/'.agent-state/recovery-probe'

def worker():
    q=Store(state)
    with Singleton(state):
        q.recover(lambda rid: {'status':'not_found'})
        job=q.claim('recovery-worker',lease_seconds=2)
        if not job:raise RuntimeError('missing_recovery_job')
        context=json.loads((state/'context.json').read_text())
        service=Service(q,root,model_config='/Users/adrian/foodmap-agent-state/pi/model-private.json')
        service.start_pi();pi=service.pi
        print(json.dumps({'phase':'started','python_pid':os.getpid(),'pi_pid':pi.proc.pid,'task_id':job['id']}),flush=True)
        try:
            def bound(s):
                q.save_session(job['id'],s['sessionFile'],s['sessionId'])
                print(json.dumps({'phase':'bound','session_id':s['sessionId'],'session_file':s['sessionFile']}),flush=True)
            result=pi.run(job,context,timeout=180,on_bound=bound)
            q.release(job['id'],'recovery-worker','verifying',proposal=result)
            print(json.dumps({'phase':'finished','task_id':job['id'],'session_id':result['session_id'],'settled':result['settled']}),flush=True)
        except Exception:
            # Simulate a crash BEFORE the normal release/finally path.
            os._exit(17)
        finally:pi.close();q.close()

def main():
    q=Store(state)
    if q.jobs():raise RuntimeError('use_fresh_isolated_recovery_directory')
    compiled=json.loads((root/'content/compiled.json').read_text())
    record=next(r for b in compiled['batches'] for r in b['records'] if r['review']['status']=='approved')
    q.discover(record['creator']['uid'],record['video']['bvid'],record['video']['part'],'real-accepted-record',record['video']['title'],1)
    task=q.jobs()[0]['id']
    evidence=state/'evidence'/task;evidence.mkdir(parents=True,exist_ok=True)
    data=json.dumps(record,ensure_ascii=False).encode();(evidence/'record.json').write_bytes(data)
    context={'task_id':task,'creator_uid':record['creator']['uid'],'bvid':record['video']['bvid'],'part':record['video']['part'],'root':str(evidence),
             'evidence':{'accepted-record':{'file':'record.json','sha256':hashlib.sha256(data).hexdigest()}},
             'prompt':{'instruction':'Recovery test with a real existing record. Read accepted-record with content_read_evidence, then submit extraction uncertain with visits [], missing [branch,poi,segment,frame,description], evidence_ids [accepted-record]. This is not a publication request.',
                       'task_id':task,'creator_uid':record['creator']['uid'],'bvid':record['video']['bvid'],'part':record['video']['part']}}
    (state/'context.json').write_text(json.dumps(context))
    q.close()
    report={'scope':'isolated real Pi/Python crash and session recovery; no production writes','task_id':task}
    command=[sys.executable,str(Path(__file__).resolve()),'--worker']
    proc=subprocess.Popen(command,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    try:
        start=json.loads(proc.stdout.readline());bound=json.loads(proc.stdout.readline())
        report['first_start']=start;report['first_bound']=bound
        deadline=time.monotonic()+15
        audit=state/'pi/model-audit.jsonl'
        while time.monotonic()<deadline:
            if audit.exists() and any('requested_model' in line for line in audit.read_text().splitlines()):break
            time.sleep(.05)
        else:raise RuntimeError('no_real_model_request')
        cli=os.environ.get('MULTICA_CLI_PATH')
        daemon=json.loads(subprocess.check_output([cli,'daemon','status','--output','json'],text=True))['pid']
        assert start['pi_pid']!=daemon and proc.pid!=daemon
        assert os.getpgid(start['pi_pid'])==start['pi_pid']
        os.killpg(start['pi_pid'],signal.SIGKILL)
        proc.kill();proc.wait(timeout=10)
        report['killed_python_pid']=proc.pid;report['killed_pi_group']=start['pi_pid']
    finally:
        if proc.poll() is None:proc.kill();proc.wait(timeout=10)
        proc.stdout.close()
    time.sleep(2.1)
    proc=subprocess.Popen(command,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    try:
        events=[]
        for line in proc.stdout:
            event=json.loads(line);events.append(event)
            if event['phase']=='finished':break
        proc.wait(timeout=15)
        report['restart_events']=events
        assert proc.returncode==0
        finished=next(e for e in events if e['phase']=='finished')
        assert finished['session_id']==bound['session_id']
        assert finished['task_id']==task and finished['settled']['aborted'] is False
        q=Store(state)
        report['jobs']=[{k:j[k] for k in ('id','stage','attempt','lease_owner','session_id')} for j in q.jobs()]
        assert len(report['jobs'])==1 and report['jobs'][0]['stage']=='verifying' and report['jobs'][0]['lease_owner'] is None
        report['passed']=True;q.close()
    finally:
        if proc.poll() is None:proc.terminate();proc.wait(timeout=15)
        proc.stdout.close()
        (root/'evidence/FACT-32/real-recovery.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'passed':report.get('passed',False),'task_id':task}))

if __name__=='__main__':
    worker() if '--worker' in sys.argv else main()
