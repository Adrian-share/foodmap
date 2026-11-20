"""Read-only classification and CAS-shaped dry-run; never applies or publishes."""
import argparse,hashlib,json,sqlite3,sys
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from foodmap_agent.pipeline import Pipeline
from foodmap_agent.retry_policy import review_policy,tool_error

def report(state,root):
    state=Path(state).resolve();root=Path(root).resolve()
    c=sqlite3.connect('file:'+str(state/'queue.sqlite3')+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;c.execute('BEGIN')
    def get(key):
        row=c.execute('select value from service_state where key=?',(key,)).fetchone();return json.loads(row[0]) if row else None
    rows=[dict(r) for r in c.execute('select * from jobs order by rowid')]
    attempts=[dict(r) for r in c.execute('select * from attempts order by rowid')]
    extractions={j['id']:get('extraction:'+j['id']) for j in rows}
    original_verifications={j['id']:get('verification:'+j['id']) for j in rows}
    runtime=get('service');watchlist=get('watchlist');c.close()
    p=object.__new__(Pipeline);p.root=root;p.node=root/'tools/node-v22.23.5-darwin-arm64/bin/node'
    result=[]
    for job in rows:
        row=dict(id=job['id'],bvid=job['bvid'],uid=job['uid'],attempt=job['attempt'],stage=job['stage'],missing=(original_verifications[job['id']] or {}).get('missing'),action='unchanged')
        saved=extractions[job['id']]
        if job['stage'] in ('failed','published','staged','cleaning','verifying') or not saved:
            row['reason']='protected_stage' if saved else 'no_settled_extraction';result.append(row);continue
        try:
            context=saved['context'];expected=state/'evidence'/job['id']
            if Path(context['root'])!=expected or expected.is_symlink():raise ValueError('wrong_task_root')
            pi_result={**saved['result']}
            # Older installed versions have no per-attempt outcome list. Read
            # the actual registered session conservatively, including earlier
            # errors, rather than infer success from Pi's missing[] narrative.
            session=Path(job['session_path']);base=state/'pi/sessions'
            if session.is_symlink() or session.resolve()!=session or not session.is_relative_to(base) or session.stat().st_size>64*1024*1024:raise ValueError('unsafe_session')
            raw=session.read_bytes();lines=[json.loads(l) for l in raw.splitlines()]
            if not lines or lines[0].get('id')!=job['session_id']:raise ValueError('wrong_session')
            errors=[];observed=0
            for line in lines:
                message=line.get('message',{})
                if message.get('role')!='toolResult':continue
                if message.get('toolName') in ('content_read_evidence','content_fetch_metadata','content_search_poi','content_capture_frame'):observed+=1
                error=tool_error(dict(toolName=message.get('toolName'),isError=message.get('isError'),result=dict(content=message.get('content',[]))))
                if error:errors.append(error)
            if observed:pi_result['tool_errors']=errors
            verified,_=p.verify(job,pi_result,context,saved['model'])
            policy=review_policy(job,pi_result,context,verified,p._read)
            row.update(policy=policy,verification=verified['status'],machine_missing=verified['missing'],session_sha256=hashlib.sha256(raw).hexdigest(),session_tool_results=observed,
                       evidence=[dict(id=k,**v) for k,v in context['evidence'].items() if k!='discovery'])
            if policy['action']=='await_new_evidence' and job['attempt']<3 and not job['lease_owner']:
                row.update(action='would_hold_pending',expected_job_sha256=hashlib.sha256(json.dumps(job,sort_keys=True).encode()).hexdigest(),
                           proposed_changes=dict(stage='pending',next_retry_at=0),preserved_fields=['attempt','session_id','session_path','proposal','error_code','registry_revision'])
        except (ValueError,KeyError,TypeError,OSError,RuntimeError) as error:row['reason']=type(error).__name__+':'+str(error)[:100]
        result.append(row)
    return dict(fixture=False,mode='read_only_dry_run',checked_at=datetime.now(timezone.utc).isoformat(),runtime=runtime,
                watchlist={k:watchlist[k] for k in ('github','registry_revision')},counts=dict(Counter(j['stage'] for j in rows)),
                attempts_sha256=hashlib.sha256(json.dumps(attempts,sort_keys=True).encode()).hexdigest(),actions=dict(Counter(r['action'] for r in result)),jobs=result,
                warnings=['No production writes, enqueue, source/model calls, publication or flags.','Review/approval and a fresh CAS check are required before applying any disposition.'])
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--state',required=True);parser.add_argument('--output',required=True);a=parser.parse_args()
    value=report(a.state,Path(__file__).resolve().parents[1]);out=Path(a.output)
    with out.open('x',encoding='utf-8') as f:f.write(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(dict(actions=value['actions'],counts=value['counts'],checked_at=value['checked_at'])))
