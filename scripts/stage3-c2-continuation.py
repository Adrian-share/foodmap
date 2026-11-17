"""One explicitly authorized C2 task in the existing preview queue, no scheduler.

Stop the existing supervised preview first; Singleton refuses concurrent owners.
--publish resumes the durable plan without another model call after root deploys.
"""
import argparse,json,subprocess,sys,time
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.service import Service,Singleton
from foodmap_agent.pipeline import Pipeline
from foodmap_agent.status import snapshot
from foodmap_agent.watchlist import now_iso

def main():
 p=argparse.ArgumentParser();p.add_argument('--state',type=Path,default=Path('/Users/adrian/foodmap-agent-state/python-preview'));p.add_argument('--archive',type=Path);p.add_argument('--publish',action='store_true');p.add_argument('--revise-exact-quote',action='store_true');a=p.parse_args()
 if subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=root,text=True).strip():raise RuntimeError('freeze_application_source_first')
 s=Store(a.state);report={'fixture':False,'scope':'manual bounded C2 task in existing preview queue; owner remains legacy','started_at':now_iso(),'publish_requested':a.publish}
 service=None;job=None
 try:
  with Singleton(s.root):
   service=Service(s,root,model_config='/Users/adrian/foodmap-agent-state/pi/model-private.json',upload_config=Path.home()/'.config/foodmap/ingest.env',mode='preview')
   operator=service.operator;s.recover(operator.lookup)
   before=operator(None);report['before']=before;report['source_commit']=service.source_commit
   report['watchlist_commit']=s.get('watchlist')['github']['commit_sha']
   if before['registry_revision']!=s.get('watchlist')['registry_revision']:raise RuntimeError('registry_checkpoint_conflict')
   jobs=[j for j in s.jobs() if j['bvid']=='BV1f6RKBDEdK' and j['part']==1]
   if len(jobs)>1:raise RuntimeError('ambiguous_existing_task')
   pipeline=service.pipeline
   if a.publish:
    if not jobs or jobs[0]['stage'] not in ('staged','published'):raise RuntimeError('no_staged_real_task')
    job=jobs[0]
    report['publication']=s.get('publication:'+job['id']) or pipeline.resume(job)
   else:
    if jobs and not a.revise_exact_quote:raise RuntimeError('existing_task_do_not_repeat_model')
    if a.revise_exact_quote:
     if not jobs or jobs[0]['stage']!='pending':raise RuntimeError('revision_requires_pending_real_proposal')
     job=jobs[0];saved=s.get('extraction:'+job['id'])
     context=saved['context']
     # The model repairs its own rejected narrative; the validator never rewrites it.
     context['prompt']={**context['prompt'],'instruction':'Your previous extraction failed independent verification because description was a narrative, not an exact substring of official metadata.data.desc. Read metadata again. Resubmit the same visit and evidence, replacing description with ONE SHORT EXACT QUOTE from metadata.data.desc, without explanations, quote marks, or provenance narration. Example exact value from the registered text: 是我喜欢的简单味道。 Keep actual source identifiers; never approve/publish. No more frames needed.'}
     s.db.execute("UPDATE jobs SET stage='discovered',next_retry_at=0 WHERE id=? AND stage='pending'",(job['id'],))
    else:
     if not a.archive:raise RuntimeError('registered_archive_required')
     url='https://api.bilibili.com/x/web-interface/view?bvid=BV1f6RKBDEdK'
     s.discover('3325087','BV1f6RKBDEdK',1,url,'曲廊院官方原视频',before['registry_revision'])
     job=next(j for j in s.jobs() if j['bvid']=='BV1f6RKBDEdK')
    s.db.execute('UPDATE jobs SET rules_version=? WHERE id=?',('v2',job['id']))
    pipeline.event(job,'pending',origin='preserved baseline pending video')
    claimed=s.claim(service.instance_id)
    if not claimed or claimed['id']!=job['id']:raise RuntimeError('queue_order_or_budget_prevented_claim')
    job=claimed
    evidence=s.root/'evidence'/job['id'];evidence.mkdir(parents=True,exist_ok=True)
    if not a.revise_exact_quote:context=dict(task_id=job['id'],creator_uid=job['uid'],bvid=job['bvid'],part=job['part'],root=str(evidence),evidence={},model_preview_bytes=0)
    context_file=evidence/'context.json';context_file.write_text(json.dumps(context))
    try:
     if not a.revise_exact_quote:
      prep=subprocess.run([str(service.node),str(root/'scripts/stage3-c2-context.mjs'),str(context_file),str(a.archive.resolve())],cwd=root,capture_output=True,text=True,timeout=55,env={'HOME':str(Path.home()),'PATH':'/usr/bin:/bin'})
      if prep.returncode:raise RuntimeError('blocked_capture_or_poi_preflight')
      report['preflight']=json.loads(prep.stdout);context=json.loads(context_file.read_text())
     service.start_pi();report['tool_audit']=service.pi.audit()
     def bound(state):s.save_session(job['id'],state.get('sessionFile'),state['sessionId'])
     result=service.pi.run(job,context,timeout=180,on_bound=bound)
     report['result']=result;report['max_rpc_line_bytes']=service.pi.max_line_bytes
     s.set('extraction:'+job['id'],dict(result=result,context=context,model=service.model))
     s.release(job['id'],service.instance_id,'verifying',proposal=result)
     service.pi.close()
     pipeline.advance(job,result,context,service.model,publish=False)
    except Exception:
     s.release(job['id'],service.instance_id,'blocked_capture','bounded_c2_capture_or_model_failed',time.time()+21600)
     raise
   report['verification']=s.get('verification:'+job['id'])
   report['status_upload_receipt']=operator(snapshot(s))
   report['after']=operator(None)
 except Exception as e:
  report['error_code']=str(e)
 finally:
  if service and service.pi:service.pi.close()
  if job:report['job']=next(j for j in s.jobs() if j['id']==job['id'])
  report['finished_at']=now_iso()
  report['model_count']=json.loads((s.root/'pi/model-audit.jsonl.count.json').read_text())
  report['unresolved_receipts']=[{'request_id':r['request_id'],'operation':json.loads(r['body']).get('operation'),'status':r['status']} for r in s.receipts() if r['status'] not in ('committed','complete')]
  output=root/'evidence/FACT-33/c2-v2'/('real-publication.json' if a.publish else 'real-pi-revision.json' if a.revise_exact_quote else 'real-pi.json')
  output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');s.close()
 print(json.dumps({k:report.get(k) for k in ('error_code','publication','verification','model_count')},ensure_ascii=False))
 return 1 if report.get('error_code') else 0

if __name__=='__main__':sys.exit(main())
