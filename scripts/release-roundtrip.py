"""R1: preflight is read-only; writes require an already reviewed frozen plan."""
import argparse,hashlib,json,sqlite3,sys,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from foodmap_agent.release_audit import RoundTrip,verify_public_version,public_json,utc,write_json
from foodmap_agent.publisher import canonical
from foodmap_agent.service import OperationClient
ROOT=Path(__file__).resolve().parents[1]
STATE=Path('/Users/adrian/foodmap-agent-state/python-preview')
CURRENT='v1-cb050932cc0417bdfdcd4c7d3b908f0c3e47949223414c3f2e9b7fe2fb669452'
BASELINE='v1-c8579269161c0ed32733da46f9c59929656ef9ac5669ac9e16390c5a194ea602'
p=argparse.ArgumentParser();p.add_argument('phase',choices=('preflight','rollback','restore'));p.add_argument('--journal',type=Path,required=True);p.add_argument('--execute-reviewed-plan',action='store_true');a=p.parse_args()
db=sqlite3.connect('file:'+str(STATE/'queue.sqlite3')+'?mode=ro',uri=True)
get=lambda k:json.loads(db.execute('select value from service_state where key=?',(k,)).fetchone()[0])
active=db.execute("select count(*) from jobs where lease_owner is not null or stage in ('cleaning','verifying','staged')").fetchone()[0]
prepared=db.execute("select count(*) from receipts where status='prepared'").fetchone()[0]
if active or prepared:raise SystemExit('active_job_or_unconfirmed_write: wait for the existing owner to drain')
history=get('publication_manifests');pointer=lambda:public_json('/api/content/current')
if a.phase=='preflight':
    live=pointer()
    if live['data_version']!=CURRENT or live['previous_data_version']!=BASELINE:raise SystemExit('current_pointer_changed: do not rebase this reviewed 16/15-store exercise')
    for v in (CURRENT,BASELINE):
        if hashlib.sha256(canonical(history[v])).hexdigest()!=v[3:]:raise SystemExit('local_manifest_hash_mismatch')
    current=verify_public_version(CURRENT);old=verify_public_version(BASELINE)
    if current['unique_stores']!=16 or old['unique_stores']!=15 or not set(old['visit_ids'])<=set(current['visit_ids']):raise SystemExit('catalog_reconciliation_failed')
    plan=dict(fixture=False,plan_id=str(uuid.uuid4()),created_at=utc(),current=live,target_version=BASELINE,restore_version=CURRENT,
              rollback_operation='release.rollback',restore_operation='release.rollback',restore_etag='freeze from rollback committed receipt and matching live pointer',production_history_will_not_be_edited=True,blobs_will_not_be_deleted=True,
              before_current=current,before_baseline=old,execution_authorized=False,requires_root_review=True)
    RoundTrip(a.journal,None,pointer).save_plan(plan);print(json.dumps(dict(preflight='passed',write_operations=0,stores=[16,15],journal=str(a.journal))))
else:
    if not a.execute_reviewed_plan:raise SystemExit('root review of this frozen plan is required before public pointer writes')
    # Do not race a production business job after the day budget becomes available.
    from datetime import datetime
    from zoneinfo import ZoneInfo
    used=db.execute('select count(*) from attempts where day=?',(datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat(),)).fetchone()[0]
    if used<10:raise SystemExit('no_exclusive_publication_window: use a reviewed drain window; do not reset the budget')
    client=OperationClient(ROOT,ROOT/'tools/node-v22.23.5-darwin-arm64/bin/node',Path('/Users/adrian/.config/foodmap/ingest.env'))
    result=RoundTrip(a.journal,client,pointer,verify_public_version).execute(a.phase)
    print(json.dumps(dict(step=a.phase,status=result['receipt']['status'],current=result['current'],verification_status=result['verification_status'])))
db.close()
