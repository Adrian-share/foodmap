"""One bounded real queue job; public submission only after independent approval."""
import argparse,base64,hashlib,json,shutil,sys,time
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.service import Service,OperationClient
from foodmap_agent.pipeline import Pipeline
p=argparse.ArgumentParser();p.add_argument('bvid');p.add_argument('query');p.add_argument('--publish',action='store_true');args=p.parse_args()
store=Store(root/'.agent-state/live-continuation')
job=next(j for j in store.jobs() if j['bvid']==args.bvid)
service=Service(store,root,model_config='/Users/adrian/foodmap-agent-state/pi/model-private.json')
claimed=store.claim(service.instance_id);assert claimed and claimed['id']==job['id']
old=json.loads((root/'.agent-state/live-screening'/args.bvid/'context.json').read_text())
evidence=store.root/'evidence'/job['id'];evidence.mkdir(parents=True,exist_ok=True)
for file in Path(old['root']).iterdir():
 if file.is_file() and file.name!='context.json':shutil.copyfile(file,evidence/file.name)
context={**old,'root':str(evidence),'task_id':job['id'],'model_preview_bytes':0}
context['prompt']=dict(task_id=job['id'],creator_uid=job['uid'],bvid=job['bvid'],part=job['part'],evidence_ids=list(context['evidence']),instruction='Real candidate. Call content_search_poi with city 北京 and query '+args.query+'. It uses fixed public Python transport. Read registered metadata/OCR evidence. You may capture at most THREE more frames at useful storefront/address/subtitle times within this video; avoid black titles/outros. Exact addresses and store/branch text must be actually supported. Descriptions must be exact original subtitle or registered OCR quotes, not invented opinions. Capture outputs include a bounded model preview; independent approval always uses full original PNG hash, not the preview. poi_candidates must be actual payload.pois[].id, while evidence_ids are artifact IDs. Description is one exact quote. Submit exactly one extraction with actual evidence IDs. Missing/ambiguous facts remain missing. Do not approve or publish. Complete within 180 seconds.')
report=dict(fixture=False,bvid=job['bvid'],uid=job['uid'],job_id=job['id'],scope='real isolated queue/Pi and independently gated publication',requested_model=service.model['model'],publish_requested=args.publish)
try:
 service.start_pi();report['tool_audit']=service.pi.audit()
 def bound(s):store.save_session(job['id'],s.get('sessionFile'),s['sessionId'])
 result=service.pi.run(job,context,timeout=180,on_bound=bound)
 store.set('extraction:'+job['id'],dict(result=result,context=context,model=service.model))
 store.release(job['id'],service.instance_id,'verifying',proposal=result)
 report['result']=result;report['rpc_max_line_bytes']=service.pi.max_line_bytes;report['image_tool_blocks']=service.pi.tool_image_blocks
 service.pi.close()
 # Publishing transport is instantiated only outside the Pi process and its clean env.
 operator=OperationClient(root,service.node,Path.home()/'.config/foodmap/ingest.env')
 pipeline=Pipeline(store,root,service.node,operator,service.source_commit)
 receipt=pipeline.advance(job,result,context,service.model,publish=args.publish)
 report['verification']=store.get('verification:'+job['id']);report['publication']=receipt
except Exception as error:
 report['error_code']=type(error).__name__
 store.release(job['id'],service.instance_id,'pending','bounded_live_attempt_failed',time.time()+21600)
finally:
 if service.pi:service.pi.close()
 report['job']=next(j for j in store.jobs() if j['id']==job['id'])
 report['model_audit']=[json.loads(l) for l in (store.root/'pi/model-audit.jsonl').read_text().splitlines()] if (store.root/'pi/model-audit.jsonl').exists() else []
 report['media_files_written']=[str(f.relative_to(store.root)) for f in evidence.rglob('*') if f.suffix in ('.mp4','.m4s','.flv','.m4a','.ts','.mp3')]
 (root/'evidence/FACT-33/live-continuation'/('real-pi-'+job['bvid']+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({k:report.get(k) for k in ('bvid','verification','publication','error_code','image_tool_blocks','rpc_max_line_bytes')},ensure_ascii=False));store.close()
