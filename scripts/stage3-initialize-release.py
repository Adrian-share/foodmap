"""Explicitly authorized baseline-only real R2 initialization; net new stores = 0."""
import json,sys,subprocess,time
from pathlib import Path
from urllib.parse import urlencode
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.service import OperationClient
from foodmap_agent.publisher import Publisher
from foodmap_agent.http_client import read_public_json

def main():
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
    # Never attribute uncommitted application changes to a published manifest.
    if subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=root,text=True).strip():
        raise RuntimeError('freeze_application_commit_first')
    state=root/'.agent-state/live-continuation';store=Store(state)
    op=OperationClient(root,root/'tools/node-v22.23.5-darwin-arm64/bin/node',Path.home()/'.config/foodmap/ingest.env')
    before=op(None)
    if before['registry_revision']!=store.get('watchlist')['registry_revision']:
        raise RuntimeError('registry_checkpoint_conflict')
    if before['current_publication'] is not None:
        raise RuntimeError('existing_dynamic_release_do_not_replace')
    pointer=read_public_json('/api/content/current')
    previous=read_public_json('/api/content/snapshot?'+urlencode({'data_version':pointer['data_version']}))
    ids={r['visit_id'] for r in previous['records']}
    if len(ids)!=15 or pointer['data_version']!=store.get('baseline')['version']:
        raise RuntimeError('frozen_baseline_mismatch')
    report=dict(fixture=False,scope='real baseline-only dynamic initialization, not E1/new-store acceptance',source_commit=commit,
                before=before,before_public_version=pointer['data_version'],net_new_stores=0,net_new_visits=0,
                dynamic_records=0,images_uploaded=0,verification_ids=0)
    lost=[False];writes=[]
    def lose_after_success(body):
        result=op(body)
        if body:
            writes.append({'operation':body.get('operation'),'request_id':body.get('request_id'),'status':result.get('status')})
        if body and body.get('operation')=='release.commit' and not lost[0]:
            lost[0]=True
            report['server_commit_receipt_before_simulated_loss']=result
            raise TimeoutError('simulated_response_loss_before_local_receipt')
        return result
    args=dict(source_commit=commit,registry_revision=before['registry_revision'],baseline_version=store.get('baseline')['version'])
    started=time.monotonic()
    try:Publisher(store,lose_after_success).publish([],[],[],**args)
    except TimeoutError:
        report['local_commit_receipt_prepared']=any(r['status']=='prepared' and json.loads(r['body'])['operation']=='release.commit' for r in store.receipts())
    else:raise RuntimeError('expected_controlled_response_loss')
    store.close()  # Reopen durable state: no in-memory success receipt is reused.
    store=Store(state)
    store.recover(op.lookup)
    receipt=Publisher(store,op).publish([],[],[],**args)
    current=op(None)['current_publication']
    after=read_public_json('/api/content/snapshot?'+urlencode({'data_version':receipt['data_version']}))
    report.update(publication=receipt,current=current,elapsed_until_public_snapshot=time.monotonic()-started,
                  after_records=len(after['records']),after_public_version=after['data_version'],write_steps=writes,
                  commit_send_count=sum(w['operation']=='release.commit' for w in writes),receipts=store.receipts())
    assert {r['visit_id'] for r in after['records']}==ids
    assert after['data_version']==receipt['data_version']==current['data_version']
    assert receipt['status']=='committed' and current['generation']==1
    assert report['local_commit_receipt_prepared'] and report['commit_send_count']==1
    assert report['elapsed_until_public_snapshot']<60
    report['protocol_initialization_passed']=True
    # This is deliberately not a passed E1/R3-added-store evidence row.
    (root/'evidence/FACT-33/live-continuation/real-baseline-release.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:report[k] for k in ('source_commit','publication','current','elapsed_until_public_snapshot','after_records','net_new_stores','commit_send_count')},ensure_ascii=False))
    store.close()
if __name__=='__main__':main()
