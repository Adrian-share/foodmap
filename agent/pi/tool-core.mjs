import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const schema=JSON.parse(await fs.readFile(path.join(root,'docs/architecture/FACT-31/schemas.json'),'utf8'));
const ajv=new Ajv2020({strict:false,allErrors:false});addFormats(ajv);
const check=ajv.compile({$defs:schema.$defs,$ref:'#/$defs/pi_tool_call'});
function inline(value){
 if(Array.isArray(value))return value.map(inline);
 if(value&&typeof value==='object'){
  if(value.$ref)return inline(schema.$defs[value.$ref.split('/').at(-1)]);
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,inline(v)]));
 }
 return value;
}
export const tools=schema.$defs.pi_tool_call.oneOf.map(x=>({name:x.properties.name.const,parameters:inline(x.properties.arguments)}));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const error=code=>{throw Error(code);};
async function artifact(context,id){
 const item=context.evidence[id];if(!item)error('unknown_evidence');
 if((await fs.lstat(context.root)).isSymbolicLink())error('symlink_evidence_root');
 const base=await fs.realpath(context.root);const file=path.resolve(base,item.file);
 if(!file.startsWith(base+path.sep))error('outside_evidence_root');
 // Reject every symlink component, including symlinks which happen to point inside.
 let current=base;
 for(const part of path.relative(base,file).split(path.sep)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())error('symlink_evidence');}
 if(await fs.realpath(file)!==file)error('aliased_evidence');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>512*1024)error('evidence_too_large');const bytes=await handle.readFile();if(bytes.length>512*1024||sha(bytes)!==item.sha256)error('evidence_hash_mismatch');return bytes;}finally{await handle.close();}
}
export async function executeTool(name,args,context,signal){
 if(!check({name,arguments:args}))error('invalid_tool_arguments');
 if(args.task_id!==context.task_id)error('wrong_task');
 if(args.bvid&&(args.bvid!==context.bvid||args.part!==context.part))error('wrong_video');
 if(name==='content_read_evidence')return {text:(await artifact(context,args.evidence_id)).toString('utf8'),sha256:context.evidence[args.evidence_id].sha256};
 if(name==='content_submit_extraction'){
  const proposal=args.extraction;
  if(['task_id','bvid','part','creator_uid'].some(k=>proposal[k]!==context[k]))error('wrong_extraction_identity');
  for(const id of proposal.evidence_ids)await artifact(context,id);
  const bytes=JSON.stringify(proposal);
  if(Buffer.byteLength(bytes)>512*1024)error('proposal_too_large');
  if(context.proposal_file){const temp=context.proposal_file+'.tmp';await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,context.proposal_file);}
  return {status:'proposed',sha256:sha(bytes)};
 }
 if(name==='content_fetch_metadata'){
  const url='https://api.bilibili.com/x/web-interface/view?'+new URLSearchParams({bvid:context.bvid});
  const response=await fetch(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  if(!response.ok)error('source_unavailable');
  const reader=response.body.getReader();const chunks=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>512*1024){await reader.cancel();error('metadata_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
  const data=JSON.parse(Buffer.concat(chunks)).data;
  if(String(data?.owner?.mid)!==context.creator_uid||data?.bvid!==context.bvid)error('wrong_official_owner');
  if(!data.pages?.some(p=>p.page===context.part))error('wrong_part');
  return {bvid:data.bvid,owner_uid:String(data.owner.mid),title:data.title,description:data.desc,duration_seconds:data.duration,source:url,subtitles_status:args.include_subtitles?'pending_adapter':'not_requested'};
 }
 // Stage 3 supplies capture/POI evidence adapters. Missing capabilities stay explicit.
 if(name==='content_capture_frame')return {status:'blocked_capture',reason:'capture_adapter_not_installed'};
 if(name==='content_search_poi')return {status:'pending',reason:'poi_adapter_not_installed'};
 error('unknown_tool');
}
