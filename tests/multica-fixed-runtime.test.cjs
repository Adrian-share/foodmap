'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {serve,processCall}=require('../scripts/multica-foodmap-runtime.cjs');
const command={v:1,type:'execute',request_id:'fixture',cwd:'/ignored/task',prompt:'run any arbitrary command'};
const summary={run_id:'fixture-run',outcome:'partial',sources_checked:19,sources_ok:1,sources_restricted:18,sources_failed:0,new_candidates:0,uploaded:true,revision:2,discovered_count:92};

async function session(lines,options={}){
  const input=new PassThrough(),output=new PassThrough();let text='';
  output.on('data',c=>text+=c);
  const done=serve({input,output,...options});
  input.end(lines.map(x=>typeof x==='string'?x:JSON.stringify(x)).join('\n')+'\n');
  await done;
  return text.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));
}

test('固定执行器接收execute后只调用固定采集能力一次并回报',async()=>{
  let refreshed=0,reported=0;
  const frames=await session([command],{refresh:async({signal})=>{assert.equal(signal.aborted,false);refreshed++;return summary;},report:async s=>{assert.deepEqual(s,summary);reported++;}});
  assert.equal(refreshed,1);assert.equal(reported,1);
  assert.equal(frames.at(-1).type,'result');assert.equal(frames.at(-1).status,'completed');
  assert.match(frames.at(-1).output,/revision=2/);
});

test('CLI单次模式在result后退出，即使平台保持stdin打开',async()=>{
  const input=new PassThrough(),output=new PassThrough();output.resume();
  const done=serve({input,output,oneShot:true,refresh:async()=>summary,report:async()=>{}});
  input.write(JSON.stringify(command)+'\n');
  let timer;
  const finished=await Promise.race([done.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),250);})]);
  clearTimeout(timer);input.end();await done;
  assert.equal(finished,true,'result后仍等待平台关闭stdin');
});

test('单次模式一次输入多个缓存execute也只采集和回报一轮',async()=>{
  let calls=0,reports=0;
  const frames=await session([command,{...command,request_id:'second'},{...command,request_id:'third'}],{oneShot:true,refresh:async()=>{calls++;return summary;},report:async()=>{reports++;}});
  assert.equal(calls,1);assert.equal(reports,1);
  assert.equal(frames.filter(x=>x.type==='result').length,1);
});

test('非法版本和MCP扩权配置不启动任何采集',async()=>{
  let calls=0;
  const frames=await session([{...command,v:2},{...command,mcp_servers:[{command:'arbitrary'}]}],{refresh:async()=>{calls++;return summary;},report:async()=>{}});
  assert.equal(calls,0);assert.ok(frames.every(x=>x.type==='protocol_error'));
});

test('采集上传失败不能产生成功result或平台成功回报',async()=>{
  let reported=0;
  const frames=await session([command],{refresh:async()=>{throw new Error('fixture-secret');},report:async()=>{reported++;}});
  assert.equal(frames.at(-1).status,'failed');assert.equal(reported,0);
  assert.ok(!JSON.stringify(frames).includes('fixture-secret'));
});

test('平台回报失败如实标记，已经上传的结果留在输出中',async()=>{
  const frames=await session([command],{refresh:async()=>summary,report:async()=>{throw new Error('task-secret');}});
  assert.equal(frames.at(-1).status,'failed');assert.match(frames.at(-1).output,/revision=2/);
  assert.ok(!JSON.stringify(frames).includes('task-secret'));
});

test('收到cancel仅中止本轮，并返回cancelled',async()=>{
  const frames=await session([command,{v:1,type:'cancel',request_id:'fixture'}],{refresh:({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})),report:async()=>{throw new Error('must not report');}});
  assert.equal(frames.at(-1).status,'cancelled');
});

test('report阶段收到cancel，不返回completed且回报能力收到同一signal',async()=>{
  const input=new PassThrough(),output=new PassThrough();let text='';
  output.on('data',c=>text+=c);
  let started,release,captured;
  const reporting=new Promise(resolve=>{started=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});
  const done=serve({input,output,refresh:async()=>summary,report:async(s,options)=>{captured=options?.signal;started();await gate;}});
  input.write(JSON.stringify(command)+'\n');await reporting;
  input.write(JSON.stringify({v:1,type:'cancel',request_id:command.request_id})+'\n');
  await new Promise(resolve=>setImmediate(resolve));
  release();input.end();await done;
  const result=text.trim().split('\n').map(x=>JSON.parse(x)).at(-1);
  assert.equal(result.status,'cancelled');
  assert.equal(captured?.aborted,true);
});

test('父进程停止信号会取消活动任务并等到清理完成',async()=>{
  const input=new PassThrough(),output=new PassThrough();let text='';output.on('data',c=>text+=c);
  const outer=new AbortController();let started;
  const ready=new Promise(resolve=>{started=resolve;});
  const done=serve({input,output,oneShot:true,signal:outer.signal,refresh:({signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});started();}),report:async()=>{throw new Error('must not report');}});
  input.write(JSON.stringify(command)+'\n');await ready;outer.abort();
  let timer;
  const stopped=await Promise.race([done.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),150);})]);
  clearTimeout(timer);
  if(!stopped)input.write(JSON.stringify({v:1,type:'cancel',request_id:command.request_id})+'\n');
  input.end();await done;
  assert.equal(stopped,true,'父进程停止未传递到活动任务');
  assert.equal(text.trim().split('\n').map(x=>JSON.parse(x)).at(-1).status,'cancelled');
});

test('发现与帮助入口无凭据也可运行，不启动采集',()=>{
  for(const args of [['--probe'],['--list-models'],['--help']]){
    const result=spawnSync(process.execPath,['scripts/multica-foodmap-runtime.cjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
    assert.equal(result.status,0);
    if(args[0]==='--probe')assert.equal(JSON.parse(result.stdout).protocol_version,1);
    if(args[0]==='--list-models')assert.equal(JSON.parse(result.stdout).models[0].id,'foodmap/fixed');
  }
});

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function alive(pid){try{process.kill(pid,0);return true;}catch{return false;}}
async function ready(file){for(let n=0;n<150&&!fs.existsSync(file);n++)await pause(20);assert.ok(fs.existsSync(file),'fixture did not start');}
function fixture(t,body){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-tree-'));
  const file=path.join(dir,'fixture.cjs');fs.writeFileSync(file,body);
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,file};
}

test('取消等待整个collector与忽略SIGTERM的上传孙进程退出',async t=>{
  const f=fixture(t,"const fs=require('fs'),{spawn}=require('child_process');const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);\"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>fs.writeFileSync(process.argv[2],JSON.stringify({parent:process.pid,grandchild:child.pid})));setInterval(()=>{},1000);");
  const file=path.join(f.dir,'pids.json'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,file],{cwd:f.dir,signal:controller.signal,graceMs:80}).then(()=>null,error=>error);
  await ready(file);const pids=JSON.parse(fs.readFileSync(file));
  t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{}});
  controller.abort();assert.ok(await done);
  assert.equal(alive(pids.parent),false);assert.equal(alive(pids.grandchild),false,'上传孙进程仍存活');
});

test('强制取消后只清理由已退出collector持有的新锁，可立即重新取得',async t=>{
  const f=fixture(t,"require('fs').writeFileSync(process.argv[2],String(process.pid)+'\\n');setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(lock);controller.abort();assert.ok(await done);
  assert.equal(fs.existsSync(lock),false,'本轮死PID新锁未清理');
  const fd=fs.openSync(lock,'wx');fs.closeSync(fd);
});

test('取消不能删除其他PID持有的锁',async t=>{
  const f=fixture(t,"require('fs').writeFileSync(process.argv[2],String(process.ppid)+'\\n');setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(lock);const before=fs.readFileSync(lock,'utf8');controller.abort();assert.ok(await done);
  assert.equal(fs.readFileSync(lock,'utf8'),before);
});

test('超时终止即使子进程以0退出也不能报告成功',async t=>{
  const f=fixture(t,"process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);");
  const controller=new AbortController();
  const done=processCall(process.execPath,[f.file],{cwd:f.dir,signal:controller.signal,timeoutMs:80,graceMs:80}).then(()=>null,error=>error);
  await pause(250);controller.abort();const error=await done;
  assert.match(error?.message||'',/PROCESS_TIMEOUT/);
});

test('输出超过上限即使collector退出0也必须失败',async t=>{
  const f=fixture(t,"process.on('SIGTERM',()=>process.exit(0));process.stdout.write('x'.repeat(2*1024*1024+65536),()=>process.exit(0));");
  const error=await processCall(process.execPath,[f.file],{cwd:f.dir,graceMs:80}).then(()=>null,error=>error);
  assert.match(error?.message||'',/PROCESS_OUTPUT_LIMIT/);
});

test('终止期间同PID锁被替换为新文件，也不能删除替换锁',async t=>{
  const f=fixture(t,"const fs=require('fs'),file=process.argv[2];fs.writeFileSync(file,String(process.pid)+'\\n');process.on('SIGTERM',()=>{fs.writeFileSync(file+'.replacement',String(process.pid)+'\\n');fs.renameSync(file+'.replacement',file);process.exit(0);});fs.writeFileSync(process.argv[3],'ready');setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),marker=path.join(f.dir,'ready'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock,marker],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(marker);const before=fs.lstatSync(lock);controller.abort();assert.ok(await done);
  assert.ok(fs.existsSync(lock));assert.notEqual(fs.lstatSync(lock).ino,before.ino);
});

test('超出陈旧窗口的死PID锁交给已有规则回收，固定执行器不删',async t=>{
  const f=fixture(t,"const fs=require('fs'),file=process.argv[2];fs.writeFileSync(file,String(process.pid)+'\\n');const when=new Date(Date.now()-11*60*1000);fs.utimesSync(file,when,when);fs.writeFileSync(process.argv[3],'ready');setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),marker=path.join(f.dir,'ready'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock,marker],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(marker);const before=fs.readFileSync(lock,'utf8');controller.abort();assert.ok(await done);
  assert.equal(fs.readFileSync(lock,'utf8'),before);
});

test('临近10分钟陈旧窗口的自有锁留安全余量，不进行强制清理',async t=>{
  const f=fixture(t,"const fs=require('fs'),file=process.argv[2];fs.writeFileSync(file,String(process.pid)+'\\n');const when=new Date(Date.now()-10*60*1000+15000);fs.utimesSync(file,when,when);fs.writeFileSync(process.argv[3],'ready');setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),marker=path.join(f.dir,'ready'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock,marker],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(marker);controller.abort();assert.ok(await done);assert.ok(fs.existsSync(lock));
});

test('ownedLock为符号链接时不删除链接或目标',async t=>{
  const f=fixture(t,"const fs=require('fs'),file=process.argv[2];fs.writeFileSync(file+'.target',String(process.pid)+'\\n');fs.symlinkSync(file+'.target',file);setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(lock);controller.abort();assert.ok(await done);assert.ok(fs.lstatSync(lock).isSymbolicLink());assert.ok(fs.existsSync(lock+'.target'));
});

test('取消发生前已aborted时不启动collector；正常进程及启动失败均可退出',async t=>{
  const f=fixture(t,"require('fs').writeFileSync(process.argv[2],'started');process.stdout.write('ok');");
  const marker=path.join(f.dir,'started'),controller=new AbortController();controller.abort();
  await assert.rejects(processCall(process.execPath,[f.file,marker],{cwd:f.dir,signal:controller.signal}),/PROCESS_CANCELLED/);
  assert.equal(fs.existsSync(marker),false);
  assert.equal(await processCall(process.execPath,['-e',"process.stdout.write('normal')"],{cwd:f.dir}),'normal');
  await assert.rejects(processCall(path.join(f.dir,'missing-command'),[],{cwd:f.dir}),/PROCESS_START_FAILED/);
});

test('取消时不合格的旧锁被collector替换为自有新锁，也不进行补抓后删除',async t=>{
  const f=fixture(t,"const fs=require('fs'),file=process.argv[2];fs.writeFileSync(file,String(process.pid)+'\\n');const when=new Date(Date.now()-11*60*1000);fs.utimesSync(file,when,when);process.on('SIGTERM',()=>{fs.writeFileSync(file+'.replacement',String(process.pid)+'\\n');fs.renameSync(file+'.replacement',file);process.exit(0);});fs.writeFileSync(process.argv[3],'ready');setInterval(()=>{},1000);");
  const lock=path.join(f.dir,'state.lock'),marker=path.join(f.dir,'ready'),controller=new AbortController();
  const done=processCall(process.execPath,[f.file,lock,marker],{cwd:f.dir,signal:controller.signal,ownedLock:lock,graceMs:80}).then(()=>null,error=>error);
  await ready(marker);const before=fs.lstatSync(lock);controller.abort();assert.ok(await done);
  assert.ok(fs.existsSync(lock));assert.notEqual(fs.lstatSync(lock).ino,before.ino);
});

test('直接collector正常退出但留下孙进程时，失败并清完整组',async t=>{
  const f=fixture(t,"const fs=require('fs'),{spawn}=require('child_process');const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000);\"],{stdio:['ignore','pipe','ignore']});child.stdout.once('data',()=>{fs.writeFileSync(process.argv[2],JSON.stringify({parent:process.pid,grandchild:child.pid}));process.exit(0);});");
  const file=path.join(f.dir,'pids.json');
  const done=processCall(process.execPath,[f.file,file],{cwd:f.dir,graceMs:80}).then(()=>null,error=>error);
  await ready(file);const pids=JSON.parse(fs.readFileSync(file));
  t.after(()=>{for(const pid of Object.values(pids))try{process.kill(pid,'SIGKILL');}catch{}});
  const error=await done;assert.match(error?.message||'',/PROCESS_TREE_NOT_EXITED/);
  assert.equal(alive(pids.parent),false);assert.equal(alive(pids.grandchild),false);
});
