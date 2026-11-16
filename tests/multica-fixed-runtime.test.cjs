'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PassThrough}=require('node:stream');
const {spawnSync}=require('node:child_process');
const {serve}=require('../scripts/multica-foodmap-runtime.cjs');
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

test('发现与帮助入口无凭据也可运行，不启动采集',()=>{
  for(const args of [['--probe'],['--list-models'],['--help']]){
    const result=spawnSync(process.execPath,['scripts/multica-foodmap-runtime.cjs',...args],{encoding:'utf8',env:{PATH:process.env.PATH}});
    assert.equal(result.status,0);
    if(args[0]==='--probe')assert.equal(JSON.parse(result.stdout).protocol_version,1);
    if(args[0]==='--list-models')assert.equal(JSON.parse(result.stdout).models[0].id,'foodmap/fixed');
  }
});
