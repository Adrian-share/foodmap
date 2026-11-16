// Real official source probe. No browser, cookies, model or publication.
import fs from 'node:fs/promises';import path from 'node:path';import {metadata,captureFrame,searchPoi} from '../agent/pi/adapters.mjs';
const root=path.resolve('.agent-state/stage3-source');await fs.mkdir(root,{recursive:true});
const context={task_id:'11111111-1111-4111-8111-111111111133',bvid:'BV1rK4AzFEpN',part:1,creator_uid:'3546971182729637',root,evidence:{}};
const report={checked_at:new Date().toISOString(),fixture:false,bvid:context.bvid,scope:'official metadata/subtitle/frame/POI, no publication'};
try{const result=await metadata(context,{include_subtitles:true});report.metadata={status:'available',title:result.payload.data.title,owner_uid:String(result.payload.data.owner.mid),subtitles_status:result.subtitles_status};}catch(e){report.metadata={status:'blocked_source',error_code:e.message};}
report.capture=await captureFrame(context,{timestamp_ms:12000},AbortSignal.timeout(55000));
report.poi=await searchPoi(context,{query:'飞天大厦 兰州牛肉面'},AbortSignal.timeout(15000));
report.files=(await fs.readdir(root));report.media_files_written=report.files.filter(f=>/\.(mp4|m4s|m4a|ts|flv|webm|mp3)$/i.test(f));
await fs.writeFile(path.join(root,'context.json'),JSON.stringify(context));
await fs.writeFile('evidence/FACT-33/real-source.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
