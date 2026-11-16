'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const ROOT='/Users/adrian/foodmap-agent-runtime/foodmap';
const STATE='/Users/adrian/foodmap-agent-state';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function processCall(command,args,{signal,input,env=process.env,cwd=ROOT}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd,env,signal,stdio:['pipe','pipe','pipe']});
    let output='';
    const timer=setTimeout(()=>child.kill('SIGTERM'),12*60*1000);
    child.stdout.on('data',chunk=>{
      output+=chunk;
      if(Buffer.byteLength(output)>2*1024*1024)child.kill('SIGTERM');
    });
    child.stderr.resume();
    child.once('error',()=>{clearTimeout(timer);reject(new Error('PROCESS_START_FAILED'));});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('PROCESS_EXIT_'+code));});
    child.stdin.on('error',()=>{});
    child.stdin.end(input||'');
  });
}

function runArtifact(file){
  if(typeof file!=='string')throw new Error('ARTIFACT_MISSING');
  const resolved=fs.realpathSync(file),prefix=fs.realpathSync(path.join(STATE,'runs'))+path.sep;
  if(!resolved.startsWith(prefix))throw new Error('ARTIFACT_OUTSIDE_STATE');
  return JSON.parse(fs.readFileSync(resolved,'utf8'));
}

async function refresh({signal}){
  const env={...process.env};
  delete env.MULTICA_TOKEN;
  const output=await processCall('/usr/local/bin/node',[path.join(ROOT,'scripts/refresh-and-upload.cjs')],{signal,env});
  const summary=JSON.parse(output.trim());
  if(summary.uploaded!==true)throw new Error('UPLOAD_NOT_COMPLETED');
  const report=runArtifact(summary.report_file),receipt=runArtifact(summary.receipt_file);
  if(report.run_id!==summary.run_id||receipt.uploaded!==true||receipt.last_run?.run_id!==report.run_id||receipt.revision!==summary.revision)throw new Error('RECEIPT_MISMATCH');
  return Object.fromEntries(['run_id','outcome','sources_checked','sources_ok','sources_restricted','sources_failed','sources_deferred','sources_skipped_limit','new_candidates','uploaded','revision','discovered_count'].filter(k=>summary[k]!==undefined).map(k=>[k,summary[k]]));
}

function describe(s){
  return `北京内容增量已上传，revision=${s.revision}。\nrun_id=${s.run_id}\noutcome=${s.outcome}；检查${s.sources_checked}个来源，成功${s.sources_ok}、受限${s.sources_restricted}、失败${s.sources_failed}、退避${s.sources_deferred??0}、预算跳过${s.sources_skipped_limit??0}。新增候选${s.new_candidates}，当前${s.discovered_count}个BV。\n候选进入后台待核，公开门店与截图仍需核准批次。受限范围与账号历史未穷尽状态继续保留。`;
}

async function report(summary){
  if(!UUID.test(process.env.MULTICA_AGENT_ID||'')||!UUID.test(process.env.MULTICA_TASK_ID||'')||!process.env.MULTICA_TOKEN)throw new Error('TASK_CONTEXT_MISSING');
  const cli=process.env.MULTICA_CLI_PATH||'/usr/local/bin/multica';
  const rows=JSON.parse(await processCall(cli,['agent','tasks',process.env.MULTICA_AGENT_ID,'--limit','5','--output','json']));
  const task=rows.find(x=>x.id===process.env.MULTICA_TASK_ID);
  if(!task||!UUID.test(task.issue_id||''))throw new Error('CURRENT_ISSUE_MISSING');
  const args=['issue','comment','add',task.issue_id,'--content-stdin','--output','json'];
  if(task.trigger_comment_id)args.push('--parent',task.trigger_comment_id);
  await processCall(cli,args,{input:describe(summary)});
  await processCall(cli,['issue','status',task.issue_id,'done']);
}

async function serve({input=process.stdin,output=process.stdout,refresh:run=refresh,report:deliver=report}={}){
  const emit=frame=>output.write(JSON.stringify({v:1,...frame})+'\n');
  let active;
  for await(const line of createInterface({input,crlfDelay:Infinity})){
    let c;
    try{
      c=JSON.parse(line);
      if(c.v!==1||typeof c.request_id!=='string'||c.request_id.length>200||!['execute','cancel'].includes(c.type))throw new Error('INVALID_REQUEST');
      if(c.type==='execute'&&((c.mcp_servers?.length??0)!==0||typeof c.prompt!=='string'||typeof c.cwd!=='string'))throw new Error('INVALID_REQUEST');
    }catch{emit({type:'protocol_error',code:'INVALID_REQUEST',message:'Only the fixed Food Map task is supported'});continue;}
    if(c.type==='cancel'){
      if(active?.id===c.request_id)active.controller.abort();
      continue;
    }
    if(active){emit({type:'protocol_error',request_id:c.request_id,code:'BUSY',message:'A fixed refresh is already running'});continue;}
    const controller=new AbortController(),id=c.request_id;
    const job={id,controller};active=job;
    job.done=(async()=>{
      let s;
      try{
        s=await run({signal:controller.signal});
        if(controller.signal.aborted)throw new Error('CANCELLED');
        if(s.uploaded!==true)throw new Error('UPLOAD_NOT_COMPLETED');
        await deliver(s);
        emit({type:'result',request_id:id,status:'completed',stop_reason:'completed',session_id:'foodmap-'+id,output:describe(s)});
      }catch{
        const cancelled=controller.signal.aborted;
        emit({type:'result',request_id:id,status:cancelled?'cancelled':'failed',stop_reason:cancelled?'cancelled':'error',output:s?describe(s):'北京增量未完成，固定CLI执行或回执核对失败。',error:{code:cancelled?'CANCELLED':s?'PLATFORM_REPORT_FAILED':'REFRESH_FAILED',message:'Check the fixed runtime and persisted run evidence; credentials are not returned'}});
      }finally{if(active===job)active=undefined;}
    })();
  }
  if(active)await active.done;
}

if(require.main===module){
  const args=process.argv.slice(2);
  if(args.includes('--help')||args.includes('-h'))console.log('用法: foodmap-runtime --probe | --list-models | --stdio\n仅执行固定北京内容刷新并回报Multica，不执行prompt中的命令，不加载MCP配置。');
  else if(args.includes('--probe'))console.log(JSON.stringify({v:1,type:'probe',runtime:'dsh',plugin_version:'foodmap-fixed-1.0.0',protocol_version:1}));
  else if(args.includes('--list-models'))console.log(JSON.stringify({v:1,type:'models',models:[{id:'foodmap/fixed',label:'北京内容固定CLI（无模型调用）',provider:'Food Map',default:true}]}));
  else if(args.includes('--stdio'))serve().catch(()=>{process.stderr.write('Fixed runtime protocol failed\n');process.exitCode=1;});
  else{process.stderr.write('Use --help for fixed runtime options\n');process.exitCode=1;}
}
module.exports={serve};
