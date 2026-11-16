import fs from 'node:fs';
import {executeTool,tools} from './tool-core.mjs';

export default function(pi:any){
 let providerRequests=0;
 const counterFile=process.env.FOODMAP_MODEL_AUDIT+'.count.json';
 try{providerRequests=JSON.parse(fs.readFileSync(counterFile,'utf8')).provider_requests||0;}catch{}
 const modelAudit=(value:any)=>{
  if(!process.env.FOODMAP_MODEL_AUDIT)return;
  fs.appendFileSync(process.env.FOODMAP_MODEL_AUDIT,JSON.stringify({at:new Date().toISOString(),...value})+'\n',{mode:0o600});
  if(value.requested_model){providerRequests++;fs.writeFileSync(counterFile+'.tmp',JSON.stringify({provider_requests:providerRequests}),{mode:0o600});fs.renameSync(counterFile+'.tmp',counterFile);}
 };
 pi.on('before_provider_request',(event:any)=>{modelAudit({requested_model:event.payload?.model});});
 pi.on('after_provider_response',(event:any)=>{modelAudit({http_status:event.status});});
 pi.on('provider_stream_event',(event:any)=>{
  if(event.data?.type==='message_start'&&typeof event.data.message?.model==='string')modelAudit({response_model:event.data.message.model});
  if(event.data?.type==='message_delta'&&event.data.usage)modelAudit({output_tokens:event.data.usage.output_tokens});
 });
 const audit=()=>{
  const active=pi.getActiveTools();
  const all=pi.getAllTools().map((t:any)=>({name:t.name,exposure:t.exposure,sourceInfo:t.sourceInfo}));
  const expected=tools.map(t=>t.name).sort();
  const valid=JSON.stringify([...active].sort())===JSON.stringify(expected)&&JSON.stringify(all.map((t:any)=>t.name).sort())===JSON.stringify(expected);
  fs.writeFileSync(process.env.FOODMAP_TOOL_AUDIT!,JSON.stringify({active,all,valid,pi_version:'1.5.2',checked_at:new Date().toISOString()}),{mode:0o600});
  if(!valid){pi.setActiveTools([]);throw Error('unexpected_tool_inventory');}
 };
 for(const tool of tools)pi.registerTool({
  name:tool.name,label:tool.name,description:'Foodmap task-scoped evidence tool; proposals require independent verification.',parameters:tool.parameters,
  async execute(_id:string,args:any,signal:AbortSignal){
   const file=process.env.FOODMAP_TASK_FILE!;
   if(!file||!fs.existsSync(file))throw Error('no_bound_task');
   const context=JSON.parse(fs.readFileSync(file,'utf8'));
   context.proposal_file=process.env.FOODMAP_PROPOSAL_FILE;
   const result=await executeTool(tool.name,args,context,signal);
   return {content:[{type:'text',text:JSON.stringify(result)}],details:{}};
  }
 });
 pi.on('session_start',()=>audit());
 pi.on('session_switch',()=>audit());
 pi.registerCommand('foodmap-tool-audit',{description:'Write fixed local tool audit without invoking the model',handler:async()=>audit()});
}
