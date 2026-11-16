#!/usr/local/bin/node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
const ROOT='/Users/adrian/foodmap-agent-runtime/foodmap';
const STATE='/Users/adrian/foodmap-agent-state';
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

const PROCESS_OUTPUT_BYTES=2*1024*1024;
const LOCK_STALE_MS=10*60*1000;
const LOCK_CLEANUP_MARGIN_MS=30000;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function groupAlive(pid){
  if(!pid)return false;
  try{process.kill(-pid,0);return true;}catch(error){return error.code!=='ESRCH';}
}
function pidExited(pid){
  try{process.kill(pid,0);return false;}catch(error){return error.code==='ESRCH';}
}
function lockIdentity(file){
  try{const stat=fs.lstatSync(file,{bigint:true});return stat.isFile()?stat:null;}catch{return null;}
}
function sameInode(a,b){return a&&b&&a.dev===b.dev&&a.ino===b.ino;}
function sameLock(a,b){
  return sameInode(a,b)&&['ctimeNs','mtimeNs','size'].every(key=>a[key]===b[key]);
}
function newOwnedLock(file,pid,initial){
  if(!file||!pid)return null;
  let fd;
  try{
    const named=lockIdentity(file);if(!named||sameInode(named,initial))return null;
    const age=Date.now()-Number(named.mtimeMs);
    // During this margin the collector's existing stale-lock rule cannot reclaim it.
    if(age<0||age>=LOCK_STALE_MS-LOCK_CLEANUP_MARGIN_MS||named.size>32n)return null;
    fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const opened=fs.fstatSync(fd,{bigint:true});if(!sameLock(named,opened))return null;
    if(fs.readFileSync(fd,'utf8').trim()!==String(pid))return null;
    if(!sameLock(opened,lockIdentity(file)))return null;
    return opened;
  }catch{return null;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
function cleanOwnedLock(file,pid,captured,initial){
  if(!captured||!pidExited(pid))return;
  const current=newOwnedLock(file,pid,initial);
  if(!sameLock(captured,current)||!sameLock(current,lockIdentity(file)))return;
  // A new, unchanged lock cannot be legally recycled by another collector yet.
  try{fs.unlinkSync(file);}catch{}
}
async function waitForGroupExit(pid,waitMs=5000){
  const until=Date.now()+waitMs;
  while(groupAlive(pid)&&Date.now()<until)await pause(20);
  return !groupAlive(pid);
}
function processCall(command,args,{signal,input,env=process.env,cwd=ROOT,timeoutMs=12*60*1000,graceMs=1000,ownedLock}={}){
  if(signal?.aborted)return Promise.reject(new Error('PROCESS_CANCELLED'));
  if(process.platform==='win32')return Promise.reject(new Error('POSIX_PROCESS_GROUP_REQUIRED'));
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(graceMs)||graceMs<0)return Promise.reject(new Error('PROCESS_LIMIT_INVALID'));
  return new Promise((resolve,reject)=>{
    const initial=ownedLock?lockIdentity(ownedLock):null;
    let child;
    try{child=spawn(command,args,{cwd,env,detached:true,stdio:['pipe','pipe','pipe']});}
    catch{return reject(new Error('PROCESS_START_FAILED'));}
    const chunks=[];
    let outputBytes=0,cause,captured,captureAttempted=false,exited=false,finishing=false,killTimer;
    function send(signalName){
      if(!child.pid)return;
      try{process.kill(-child.pid,signalName);}catch(error){
        // An abort can arrive before setsid; the ChildProcess handle still owns this PID.
        if(error.code==='ESRCH'&&!exited)child.kill(signalName);
      }
    }
    function stop(reason){
      if(cause)return;
      cause=new Error(reason);
      captureAttempted=true;captured=newOwnedLock(ownedLock,child.pid,initial);
      send('SIGTERM');
      killTimer=setTimeout(()=>{if(groupAlive(child.pid)||!exited)send('SIGKILL');},graceMs);
    }
    const onAbort=()=>stop('PROCESS_CANCELLED');
    const timer=setTimeout(()=>stop('PROCESS_TIMEOUT'),timeoutMs);
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted)onAbort();
    child.stdout.on('data',chunk=>{
      if(cause)return;
      outputBytes+=chunk.length;
      if(outputBytes>PROCESS_OUTPUT_BYTES){stop('PROCESS_OUTPUT_LIMIT');return;}
      chunks.push(chunk);
    });
    child.stderr.resume();
    child.once('error',()=>stop('PROCESS_START_FAILED'));
    child.once('exit',()=>{exited=true;});
    child.once('close',async code=>{
      if(finishing)return;finishing=true;exited=true;
      // A descendant with its stdio closed can outlive a successful direct child.
      if(groupAlive(child.pid)&&!cause)stop('PROCESS_TREE_NOT_EXITED');
      if(!cause&&code!==0)cause=new Error('PROCESS_EXIT_'+code);
      if(cause&&!captureAttempted){captureAttempted=true;captured=newOwnedLock(ownedLock,child.pid,initial);}
      const gone=await waitForGroupExit(child.pid,Math.max(5000,graceMs+1000));
      clearTimeout(timer);clearTimeout(killTimer);signal?.removeEventListener('abort',onAbort);
      if(!gone)return reject(new Error('PROCESS_GROUP_NOT_EXITED'));
      if(cause)cleanOwnedLock(ownedLock,child.pid,captured,initial);
      cause?reject(cause):resolve(Buffer.concat(chunks,outputBytes).toString('utf8'));
    });
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
  const output=await processCall('/usr/bin/sandbox-exec',['-f',path.join(ROOT,'deployment/foodmap-sync/collector.sb'),'/usr/local/bin/node',path.join(ROOT,'scripts/refresh-and-upload.cjs')],{signal,env,ownedLock:path.join(STATE,'incremental-state.json.lock')});
  const summary=JSON.parse(output.trim());
  if(summary.uploaded!==true)throw new Error('UPLOAD_NOT_COMPLETED');
  const report=runArtifact(summary.report_file),receipt=runArtifact(summary.receipt_file);
  if(report.run_id!==summary.run_id||receipt.uploaded!==true||receipt.last_run?.run_id!==report.run_id||receipt.revision!==summary.revision)throw new Error('RECEIPT_MISMATCH');
  return Object.fromEntries(['run_id','outcome','sources_checked','sources_ok','sources_restricted','sources_failed','sources_deferred','sources_skipped_limit','new_candidates','uploaded','revision','discovered_count'].filter(k=>summary[k]!==undefined).map(k=>[k,summary[k]]));
}

function describe(s){
  return `北京内容增量已上传，revision=${s.revision}。\nrun_id=${s.run_id}\noutcome=${s.outcome}；检查${s.sources_checked}个来源，成功${s.sources_ok}、受限${s.sources_restricted}、失败${s.sources_failed}、退避${s.sources_deferred??0}、预算跳过${s.sources_skipped_limit??0}。新增候选${s.new_candidates}，当前${s.discovered_count}个BV。\n候选进入后台待核，公开门店与截图仍需核准批次。受限范围与账号历史未穷尽状态继续保留。`;
}

async function report(summary,{signal}={}){
  signal?.throwIfAborted();
  if(!UUID.test(process.env.MULTICA_AGENT_ID||'')||!UUID.test(process.env.MULTICA_TASK_ID||'')||!process.env.MULTICA_TOKEN)throw new Error('TASK_CONTEXT_MISSING');
  const cli=process.env.MULTICA_CLI_PATH||'/usr/local/bin/multica';
  const rows=JSON.parse(await processCall(cli,['agent','tasks',process.env.MULTICA_AGENT_ID,'--limit','5','--output','json'],{signal}));
  const task=rows.find(x=>x.id===process.env.MULTICA_TASK_ID);
  if(!task||!UUID.test(task.issue_id||''))throw new Error('CURRENT_ISSUE_MISSING');
  const args=['issue','comment','add',task.issue_id,'--content-stdin','--output','json'];
  if(task.trigger_comment_id)args.push('--parent',task.trigger_comment_id);
  signal?.throwIfAborted();
  await processCall(cli,args,{signal,input:describe(summary)});
  signal?.throwIfAborted();
  await processCall(cli,['issue','status',task.issue_id,'done'],{signal});
}

async function serve({input=process.stdin,output=process.stdout,refresh:run=refresh,report:deliver=report,oneShot=false,signal}={}){
  const emit=frame=>output.write(JSON.stringify({v:1,...frame})+'\n');
  const reader=createInterface({input,crlfDelay:Infinity});
  let active,accepted=false,finished=false;
  const stop=()=>{active?.controller.abort();reader.close();};
  signal?.addEventListener('abort',stop,{once:true});
  if(signal?.aborted)stop();
  for await(const line of reader){
    if((oneShot&&finished)||signal?.aborted)break;
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
    if(active||(oneShot&&accepted)){emit({type:'protocol_error',request_id:c.request_id,code:'BUSY',message:'A fixed refresh is already running'});continue;}
    accepted=true;
    const controller=new AbortController(),id=c.request_id;
    const job={id,controller};active=job;
    job.done=(async()=>{
      let s;
      try{
        s=await run({signal:controller.signal});
        if(controller.signal.aborted)throw new Error('CANCELLED');
        if(s.uploaded!==true)throw new Error('UPLOAD_NOT_COMPLETED');
        await deliver(s,{signal:controller.signal});
        controller.signal.throwIfAborted();
        emit({type:'result',request_id:id,status:'completed',stop_reason:'completed',session_id:'foodmap-'+id,output:describe(s)});
      }catch{
        const cancelled=controller.signal.aborted;
        emit({type:'result',request_id:id,status:cancelled?'cancelled':'failed',stop_reason:cancelled?'cancelled':'error',output:s?describe(s):'北京增量未完成，固定CLI执行或回执核对失败。',error:{code:cancelled?'CANCELLED':s?'PLATFORM_REPORT_FAILED':'REFRESH_FAILED',message:'Check the fixed runtime and persisted run evidence; credentials are not returned'}});
      }finally{if(active===job)active=undefined;if(oneShot){finished=true;reader.close();}}
    })();
  }
  if(active)await active.done;
  signal?.removeEventListener('abort',stop);
}

if(require.main===module){
  const args=process.argv.slice(2);
  if(args.includes('--help')||args.includes('-h'))console.log('用法: foodmap-runtime --probe | --list-models | --stdio\n仅执行固定北京内容刷新并回报Multica，不执行prompt中的命令，不加载MCP配置。');
  else if(args.includes('--probe'))console.log(JSON.stringify({v:1,type:'probe',runtime:'dsh',plugin_version:'foodmap-fixed-1.0.0',protocol_version:1}));
  else if(args.includes('--list-models'))console.log(JSON.stringify({v:1,type:'models',models:[{id:'foodmap/fixed',label:'北京内容固定CLI（无模型调用）',provider:'Food Map',default:true}]}));
  else if(args.includes('--stdio')){
    const controller=new AbortController(),stop=()=>controller.abort();
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
    serve({oneShot:true,signal:controller.signal}).then(()=>process.stdin.destroy()).catch(()=>{process.stderr.write('Fixed runtime protocol failed\n');process.exitCode=1;}).finally(()=>{
      process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);
    });
  }
  else{process.stderr.write('Use --help for fixed runtime options\n');process.exitCode=1;}
}
module.exports={serve,processCall};
