"""One real candidate through locked Pi tools and independent verification; no upload."""
import hashlib,json,sys,uuid
from pathlib import Path
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from foodmap_agent.queue import Store
from foodmap_agent.service import Service
state=root/'.agent-state/stage3-pi';store=Store(state)
service=Service(store,root,model_config='/Users/adrian/foodmap-agent-state/pi/model-private.json')
task=str(uuid.uuid4());evidence=state/'evidence'/task;evidence.mkdir(parents=True,exist_ok=True)
identity=dict(task_id=task,creator_uid='3546971182729637',bvid='BV1rK4AzFEpN',part=1)
lead=dict(title='自费北京兰州牛肉面：甘肃驻京办、飞天大厦',note='Lead only, exact branch and description require independent source evidence.')
raw=json.dumps(lead,ensure_ascii=False).encode();(evidence/'lead.json').write_bytes(raw)
context=dict(**identity,root=str(evidence),evidence={'lead':dict(file='lead.json',sha256=hashlib.sha256(raw).hexdigest())},prompt=dict(**identity,instruction='Use the five fixed tools to inspect this real candidate. Fetch official metadata including subtitles. Capture original frame at 12000ms and inspect the tool image. Search Beijing POI for 飞天大厦 兰州牛肉面. Submit one extraction with only actually registered evidence IDs. Descriptions may quote registered official subtitles or registered original-frame OCR only. Missing exact branch/address/POI or original description must stay uncertain with explicit missing fields, never invent or approve. At most one metadata request, one frame capture and one POI search. Do not publish.'))
report=dict(fixture=False,bvid=identity['bvid'],scope='real Pi on unapproved candidate, no production writes',provider=service.model['provider'],requested_model=service.model['model'])
try:
 service.start_pi();report['audit']=service.pi.audit()
 result=service.pi.run({'id':task,'session_path':None},context,timeout=180)
 report['settled']=result['settled'];report['session_id']=result['session_id'];report['proposal']=result['proposal']
 verified,images=service.pipeline.verify({'id':task},result,context,service.model)
 report['independent_verification']={k:verified[k] for k in ('status','missing')}
 report['registered_evidence']=[dict(id=k,sha256=v['sha256'],kind=v.get('kind')) for k,v in context['evidence'].items()]
 report['private_frame_hashes']=list(context.get('frame_files',{}))
 report['public_images']=[{k:v for k,v in i.items() if k!='data'} for i in images]
 report['pi_completed']=True
except Exception as error:
 report['pi_completed']=False;report['error_code']=type(error).__name__
finally:
 if service.pi:service.pi.close()
 report['model_audit']=[json.loads(l) for l in (state/'pi/model-audit.jsonl').read_text().splitlines()] if (state/'pi/model-audit.jsonl').exists() else []
 report['model_audit']=[a for a in report['model_audit'] if a['at']>=report.get('audit',{}).get('checked_at','')]
 report['media_files_written']=[str(f.relative_to(state)) for f in state.rglob('*') if f.suffix in ('.mp4','.m4s','.m4a','.flv','.ts','.mp3')]
 (root/'evidence/FACT-33/real-pi-candidate.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 store.close();print(json.dumps({k:report[k] for k in ('pi_completed','bvid')},ensure_ascii=False))
