"""One real model timeout, ordered cancellation, then healthy Pi session reuse."""
import hashlib
import json
from pathlib import Path
import sys
import time
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.service import Service
from foodmap_agent.pi_rpc import cancel_rpc
q=Store(root/'.agent-state/cancel-probe')
record=next(r for b in json.loads((root/'content/compiled.json').read_text())['batches'] for r in b['records'] if r['review']['status']=='approved')
q.discover(record['creator']['uid'],record['video']['bvid'],record['video']['part'],'real-record',record['video']['title'],1)
job=q.claim('cancel-probe',daily_limit=10)
if not job:raise RuntimeError('fresh isolated cancel directory required')
s=Service(q,root,model_config='/Users/adrian/foodmap-agent-state/pi/model-private.json');s.start_pi();pi=s.pi
report={'scope':'isolated actual Pi/model timeout and cancellation, no upload or publication','task_id':job['id']}
evidence=q.root/'evidence'/job['id'];evidence.mkdir(parents=True,exist_ok=True)
raw=json.dumps(record).encode();(evidence/'record.json').write_bytes(raw)
context={'task_id':job['id'],'creator_uid':job['uid'],'bvid':job['bvid'],'part':job['part'],'root':str(evidence),
         'evidence':{'record':{'file':'record.json','sha256':hashlib.sha256(raw).hexdigest()}},
         'prompt':{'instruction':'Read record, then submit uncertain extraction with no visits and missing branch/poi/segment/frame/description, evidence_ids [record]. This is only a cancellation test.',
                   'task_id':job['id'],'creator_uid':job['uid'],'bvid':job['bvid'],'part':job['part']}}
try:
    try:pi.run(job,context,timeout=.001)
    except TimeoutError:report['timed_out']=True
    q.release(job['id'],'cancel-probe','discovered','cancelled')
    report['after_cancel']=cancel_rpc(pi.request)
    report['audit']=pi.audit()
    retry=q.claim('cancel-probe')
    assert retry['id']==job['id']
    result=pi.run(retry,context,timeout=180)
    q.release(retry['id'],'cancel-probe','verifying',proposal=result)
    report['retry_settled']=result['settled']
    report['lease_released']=q.jobs()[0]['lease_owner'] is None
    report['passed']=report.get('timed_out') and report['lease_released'] and not report['after_cancel']['isStreaming']
finally:
    pi.close();q.close()
    (root/'evidence/FACT-32/real-cancel.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'passed':report.get('passed',False)}))
