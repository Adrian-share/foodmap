import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {metadata,captureFrame,searchPoi} from './adapters.mjs';
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
 return artifactItem(context,item);
}
async function artifactItem(context,item,limit=512*1024){
 if((await fs.lstat(context.root)).isSymbolicLink())error('symlink_evidence_root');
 const base=await fs.realpath(context.root);const file=path.resolve(base,item.file);
 if(!file.startsWith(base+path.sep))error('outside_evidence_root');
 // Reject every symlink component, including symlinks which happen to point inside.
 let current=base;
 for(const part of path.relative(base,file).split(path.sep)){current=path.join(current,part);if((await fs.lstat(current)).isSymbolicLink())error('symlink_evidence');}
 if(await fs.realpath(file)!==file)error('aliased_evidence');
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>limit)error('evidence_too_large');const bytes=await handle.readFile();if(bytes.length>limit||sha(bytes)!==item.sha256)error('evidence_hash_mismatch');return bytes;}finally{await handle.close();}
}
export async function executeTool(name,args,context,signal,adapters={}){
 if(!check({name,arguments:args}))error('invalid_tool_arguments');
 if(args.task_id!==context.task_id)error('wrong_task');
 if(args.bvid&&(args.bvid!==context.bvid||args.part!==context.part))error('wrong_video');
 if(context.proposal_submitted)return {status:'proposal_already_submitted'};
 if(name==='content_read_evidence')return {text:(await artifact(context,args.evidence_id)).toString('utf8'),sha256:context.evidence[args.evidence_id].sha256};
 if(name==='content_submit_extraction'){
  const proposal=args.extraction;
  if(['task_id','bvid','part','creator_uid'].some(k=>proposal[k]!==context[k]))error('wrong_extraction_identity');
  for(const id of proposal.evidence_ids)await artifact(context,id);
  const bytes=JSON.stringify(proposal);
  if(Buffer.byteLength(bytes)>512*1024)error('proposal_too_large');
  if(context.proposal_file){const temp=context.proposal_file+'.tmp';await fs.writeFile(temp,bytes,{mode:0o600});await fs.rename(temp,context.proposal_file);}
  context.proposal_submitted=true;
  return {status:'proposed',sha256:sha(bytes)};
 }
 if(name==='content_fetch_metadata')return metadata(context,args,signal);
 if(name==='content_capture_frame'){
  const cached=!!context.evidence['frame:'+args.timestamp_ms];
  if(!cached&&(context.frame_capture_count||0)>=3)return {status:'pending_budget',reason:'frame_sampling_budget_exhausted',evidence_ids:Object.keys(context.evidence)};
  if(!cached&&adapters.captureFrame)context.frame_capture_count=(context.frame_capture_count||0)+1;
  return (adapters.captureFrame||captureFrame)(context,args,signal);
 }
 if(name==='content_search_poi')return searchPoi(context,args,signal,adapters);
 error('unknown_tool');
}
// Pi may execute a batch of tool calls concurrently. Serialize the entire read /
// execute / rename transaction so a slow network result cannot erase another tool.
const pendingTasks=new Map();
export async function executeTask(file,proposal_file,name,args,signal,adapters={}){
 const previous=pendingTasks.get(file)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  signal?.throwIfAborted();
  const context=JSON.parse(await fs.readFile(file,'utf8'));context.proposal_file=proposal_file;
  const result=await executeTool(name,args,context,signal,adapters);
  const {proposal_file:unused,...persisted}=context;
  await fs.writeFile(file+'.tmp',JSON.stringify(persisted),{mode:0o600});await fs.rename(file+'.tmp',file);
  return {result,context};
 });
 pendingTasks.set(file,next);
 try{return await next;}finally{if(pendingTasks.get(file)===next)pendingTasks.delete(file);}
}
