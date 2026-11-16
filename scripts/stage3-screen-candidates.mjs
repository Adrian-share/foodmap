// Real source preflight, no model or publication. All BV/owners come from the preserved ledger.
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
import {metadata,captureFrame} from '../agent/pi/adapters.mjs';
const compiled=JSON.parse(await fs.readFile('content/compiled.json','utf8'));
const targets=process.argv.slice(2);if(!targets.length||targets.length>6)throw Error('bounded_candidate_list_required');
const report=[];
for(const bvid of targets){const row=compiled.ledger.videos.find(v=>v.bvid===bvid&&v.status==='pending')||JSON.parse(await fs.readFile('evidence/FACT-33/live-continuation/related-real-source.json','utf8')).data.filter(v=>v.bvid===bvid).map(v=>({creator_uid:String(v.owner.mid)}))[0];if(!row)throw Error('not_verified_candidate_source');
 const root=path.resolve('.agent-state/live-screening',bvid);await fs.mkdir(root,{recursive:true,mode:0o700});
 const context={task_id:crypto.randomUUID(),creator_uid:row.creator_uid,bvid,part:1,root,evidence:{},adapters:{quality:64}};
 const item={bvid,creator_uid:row.creator_uid,fixture:false,frames:[]};
 try{const m=await metadata(context,{include_subtitles:false},AbortSignal.timeout(20000));const duration=m.payload.data.pages.find(p=>p.page===1).duration;item.title=m.payload.data.title;item.duration=duration;
 for(const t of (process.env.FOODMAP_CAPTURE_TIMES?process.env.FOODMAP_CAPTURE_TIMES.split(',').map(Number):[5000,15000,30000]).filter(t=>Number.isInteger(t)&&t>=0&&t<=duration*1000)){const r=await captureFrame(context,{timestamp_ms:t},AbortSignal.timeout(65000));item.frames.push(r.status==='captured'?{status:r.status,payload:r.payload,ocr:r.ocr?.payload,preview:r.preview}:{...r,timestamp_ms:t});await fs.writeFile(path.join(root,'context.json'),JSON.stringify(context,null,2));console.log(JSON.stringify({bvid,t,status:r.status,quality:r.payload?.actual_quality,width:r.payload?.width,height:r.payload?.height,ocr:r.ocr?.payload.lines}));}
 }catch(e){item.error_code=e.message;}
 report.push(item);await fs.writeFile('evidence/FACT-33/live-continuation/screening-'+targets[0]+'.json',JSON.stringify(report,null,2)+'\n');}
