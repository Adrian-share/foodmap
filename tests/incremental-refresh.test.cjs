'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runIncremental,loadState,buildKnownBvids,mergeDiscovery,classifyOutcome}=require('../scripts/refresh-creator-inventory-incremental.cjs');
const {buildLedger}=require('../content/ledger.cjs');

const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'incr-refresh-'));
const stateFile=t=>path.join(t,'incremental-state.json');
const runsDir=t=>path.join(t,'runs');
const writeJson=(file,obj)=>fs.writeFileSync(file,JSON.stringify(obj));
const emptyState=()=>({schema:1,updated_at:null,discoveries:[],accounts:[],seasons:[],videos:[],failures:{}});
const tinySeed=uids=>({creators:uids.map(uid=>({uid,name:'creator '+uid})),videos:[]});
const tinyLedger=uids=>({creators:uids.map(uid=>({uid,name:'creator '+uid})),videos:[]});

function postsMock(getPosts){
  return async function fetch(url){
    if(url.includes('/x/space/wbi/arc/search')){
      return {status:200,text:async()=>JSON.stringify({code:0,data:{list:{vlist:getPosts()}}})};
    }
    if(url.includes('/x/web-interface/view')){
      return {status:200,text:async()=>JSON.stringify({code:0,data:{owner:{mid:111},title:'video',pubdate:1700000000}})};
    }
    throw new Error('unexpected url '+url);
  };
}

test('S1 增量幂等：同输入不重复，新增只追加一条',async()=>{
  const t=tmp();
  const posts=[
    {bvid:'BVAAAAAAAAAA',title:'第一条',created:1700000000,mid:'111'},
    {bvid:'BVBBBBBBBBBB',title:'第二条',created:1700000001,mid:'111'},
  ];
  const options={root:t,state:stateFile(t),runsDir:runsDir(t),seed:tinySeed(['111']),ledger:tinyLedger(['111']),fetch:postsMock(()=>posts)};
  writeJson(stateFile(t),emptyState());

  const r1=await runIncremental(options);
  assert.equal(r1.outcome,'new_content');
  assert.equal(r1.new_candidates.length,2);
  assert.equal(r1.duplicate_count,0);
  assert.equal(r1.discovered_total,2);
  assert.deepEqual(r1.new_candidates.map(c=>c.bvid).sort(),['BVAAAAAAAAAA','BVBBBBBBBBBB']);

  const r2=await runIncremental(options);
  assert.equal(r2.outcome,'no_new');
  assert.equal(r2.new_candidates.length,0);
  assert.equal(r2.duplicate_count,2);
  let state=loadState(stateFile(t),__dirname);
  assert.equal(state.discoveries.length,2,'重复运行不应产生重复行');

  posts.push({bvid:'BVCCCCCCCCCC',title:'第三条',created:1700000002,mid:'111'});
  const r3=await runIncremental(options);
  assert.equal(r3.outcome,'new_content');
  assert.equal(r3.new_candidates.length,1);
  assert.equal(r3.new_candidates[0].bvid,'BVCCCCCCCCCC');
  assert.equal(r3.new_candidates[0].creator_uid,'111');
  assert.equal(r3.new_candidates[0].title,'第三条');
  assert.equal(r3.new_candidates[0].published_at,new Date(1700000002*1000).toISOString());

  state=loadState(stateFile(t),__dirname);
  assert.equal(state.discoveries.length,3);
  fs.rmSync(t,{recursive:true,force:true});
});

test('S2 部分失败：失败进入 failures，历史成功范围保留',async()=>{
  const t=tmp();
  const priorAccount={uid:'BBB',http_status:200,code:0,checked_at:'2026-11-10T00:00:00.000Z',url:'https://api.bilibili.com/x/space/wbi/arc/search?mid=BBB&pn=1&ps=30&order=pubdate',scope:'公开投稿列表第1页',last_page:1,reached_end:false,restriction:'仅访问第1页，不代表历史穷尽',next_step:'提供可访问的官方投稿导出/官方合集或北京原视频链接，核对分店后走批次审核。'};
  const seed={schema:1,updated_at:null,discoveries:[],accounts:[priorAccount],seasons:[],failures:{}};
  writeJson(stateFile(t),seed);

  const fetch=async url=>{
    if(url.includes('mid=AAA'))return {status:200,text:async()=>JSON.stringify({code:0,data:{list:{vlist:[{bvid:'BVAAAAAAAAAA',title:'A 的视频',created:1700000000,mid:'AAA'}]}}})};
    if(url.includes('mid=BBB'))throw new Error('network down');
    if(url.includes('/x/web-interface/view'))return {status:200,text:async()=>JSON.stringify({code:0,data:{owner:{mid:111},title:'v',pubdate:1700000000}})};
    throw new Error('unexpected url '+url);
  };

  const report=await runIncremental({root:t,state:stateFile(t),runsDir:runsDir(t),seed:tinySeed(['AAA','BBB']),ledger:tinyLedger(['AAA','BBB']),fetch});
  assert.equal(report.outcome,'partial');
  assert.equal(report.sources_ok,1);
  assert.equal(report.sources_failed,1);
  assert.deepEqual(report.errors,[{source:'posts:BBB',error:'Error:network down'}]);

  const state=loadState(stateFile(t),__dirname);
  assert.ok(state.failures['posts:BBB'],'BBB 失败应写入 failures');
  assert.equal(state.failures['posts:BBB'].consecutive_failures,1);
  assert.ok(Date.parse(state.failures['posts:BBB'].next_retry_after)>Date.now(),'退避时间应在未来');

  const bbb=state.accounts.find(a=>a.uid==='BBB');
  assert.ok(bbb,'BBB 的历史账号记录应保留');
  assert.equal(bbb.code,null,'应报告 BBB 的最新失败');
  assert.equal(bbb.error,'Error:network down');
  assert.equal(bbb.last_success_at,priorAccount.checked_at,'失败不应抹掉 BBB 的上次成功时间');
  assert.equal(bbb.last_success_range.scope,priorAccount.scope);
  assert.equal(report.last_success_ranges.BBB.last_success_at,priorAccount.checked_at);
  const aaa=state.accounts.find(a=>a.uid==='AAA');
  assert.equal(aaa.code,0);
  assert.ok(state.discoveries.some(d=>d.bvid==='BVAAAAAAAAAA'&&d.creator_uid==='AAA'));

  const savedPath=stateFile(t);
  assert.equal(fs.readdirSync(t).filter(f=>f.endsWith('.tmp')).length,0,'不应残留 .tmp');
  fs.rmSync(t,{recursive:true,force:true});
});

test('S2 退避：未来重试时间前跳过该源',async()=>{
  const t=tmp();
  const future=new Date(Date.now()+300000).toISOString();
  writeJson(stateFile(t),{schema:1,updated_at:null,discoveries:[],accounts:[],seasons:[],failures:{'posts:BBB':{consecutive_failures:1,last_failure_at:new Date().toISOString(),next_retry_after:future}}});

  const calls=[];
  const fetch=async url=>{
    calls.push(url);
    if(url.includes('mid=AAA'))return {status:200,text:async()=>JSON.stringify({code:0,data:{list:{vlist:[]}}})};
    if(url.includes('mid=BBB'))throw new Error('network down');
    if(url.includes('/x/web-interface/view'))return {status:200,text:async()=>JSON.stringify({code:0,data:{owner:{mid:111},title:'v',pubdate:1700000000}})};
    throw new Error('unexpected url '+url);
  };

  const report=await runIncremental({root:t,state:stateFile(t),runsDir:runsDir(t),seed:tinySeed(['AAA','BBB']),ledger:tinyLedger(['AAA','BBB']),fetch});
  assert.equal(report.sources_deferred,1);
  assert.equal(report.sources_failed,0);
  assert.equal(report.outcome,'partial','本轮有源未检查，不应报告 no_new');
  assert.equal(report.partial,true);
  assert.ok(!calls.some(u=>u.includes('mid=BBB')),'退避未到期不应再次抓取 BBB');

  const state=loadState(stateFile(t),__dirname);
  assert.equal(state.failures['posts:BBB'].next_retry_after,future,'退避记录不应被修改');
  fs.rmSync(t,{recursive:true,force:true});
});

test('互斥锁：已存在锁时返回 locked 且不改状态',async()=>{
  const t=tmp();
  const before=JSON.stringify(emptyState());
  writeJson(stateFile(t),emptyState());
  fs.writeFileSync(stateFile(t)+'.lock','99999\n');

  const report=await runIncremental({root:t,state:stateFile(t),runsDir:runsDir(t),seed:tinySeed(['111']),ledger:tinyLedger(['111']),fetch:postsMock(()=>[])});
  assert.equal(report.outcome,'locked');
  assert.equal(JSON.stringify(loadState(stateFile(t),__dirname)),before,'locked 不应改动状态文件');
  assert.ok(fs.existsSync(stateFile(t)+'.lock'),'新锁不应被删除');
  fs.rmSync(t,{recursive:true,force:true});
});

test('S3 候选队列：owner_verified 增量发现进入待核且不增加公开数',()=>{
  const snapshot={as_of:'2026-11-12',creators:[{uid:'111',name:'creator 111'}],videos:[]};
  const access={checked_at:'2026-11-16T00:00:00.000Z',accounts:[],seasons:[],videos:[],discoveries:[{bvid:'BVAAAAAAAAAA',creator_uid:'111',title:'待核新线索',published_at:'2026-11-15T00:00:00.000Z',discovered_at:'2026-11-16T00:00:00.000Z',owner_verified:true,source:'posts:111'}]};
  const ledger=buildLedger({snapshot,records:[],access,historical:{},accounts:[],samples:[]});
  const v=ledger.videos.find(v=>v.bvid==='BVAAAAAAAAAA');
  assert.ok(v);
  assert.equal(v.status,'pending');
  assert.equal(ledger.videos.filter(x=>x.status==='published').length,0);
  assert.equal(ledger.creators[0].counts.pending,1);
  assert.equal(ledger.creators[0].counts.published,0);
});

test('辅助函数：已知集、合并与结果分类',()=>{
  const known=buildKnownBvids({seed:{videos:[{bvid:'BVAAAAAAAAAA'}]},ledger:{videos:[{bvid:'BVBBBBBBBBBB'}]},discoveries:[{bvid:'BVCCCCCCCCCC'}]});
  assert.deepEqual([...known].sort(),['BVAAAAAAAAAA','BVBBBBBBBBBB','BVCCCCCCCCCC']);

  const merged=mergeDiscovery(
    {discoveries:[{creator_uid:'1',bvid:'BVAAAAAAAAAA',source:'a',title:'old',discovered_at:'2026-01-01T00:00:00.000Z'}],seasons:[]},
    {discoveries:[{creator_uid:'1',bvid:'BVAAAAAAAAAA',source:'a',title:'new',discovered_at:'2026-02-01T00:00:00.000Z'}],seasons:[]}
  );
  assert.equal(merged.discoveries.length,1);
  assert.equal(merged.discoveries[0].discovered_at,'2026-01-01T00:00:00.000Z','应保留最早 discovered_at');

  assert.equal(classifyOutcome({locked:true,attempted:1,failed:0,restricted:0,newCount:0}),'locked');
  assert.equal(classifyOutcome({locked:false,attempted:2,failed:2,restricted:0,newCount:0}),'failed');
  assert.equal(classifyOutcome({locked:false,attempted:2,failed:1,restricted:0,newCount:1}),'partial');
  assert.equal(classifyOutcome({locked:false,attempted:2,failed:0,restricted:1,newCount:1}),'partial');
  assert.equal(classifyOutcome({locked:false,attempted:2,failed:0,restricted:0,newCount:1}),'new_content');
  assert.equal(classifyOutcome({locked:false,attempted:2,failed:0,restricted:0,newCount:0}),'no_new');
});

const runOptions=(t,uids=[])=>({root:t,state:stateFile(t),runsDir:runsDir(t),seed:tinySeed(uids),ledger:tinyLedger(uids)});
const jsonResponse=(data,status=200)=>({status,text:async()=>JSON.stringify(data)});
test('每轮上传快照独立，下一轮采集不能覆盖上一轮证据',async t=>{
  const dir=tmp();t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const posts=[{bvid:'BVAAAAAAAAAA',title:'第一条',created:1700000000,mid:'111'}];
  const options={...runOptions(dir,['111']),fetch:postsMock(()=>posts)};
  writeJson(stateFile(dir),emptyState());
  const first=await runIncremental(options);
  assert.equal(typeof first.run_snapshot_file,'string');
  const initial=fs.readFileSync(first.run_snapshot_file,'utf8');
  posts.push({bvid:'BVBBBBBBBBBB',title:'第二条',created:1700000001,mid:'111'});
  const second=await runIncremental(options);
  assert.notEqual(first.run_snapshot_file,second.run_snapshot_file);
  assert.equal(fs.readFileSync(first.run_snapshot_file,'utf8'),initial);
  assert.equal(JSON.parse(initial).discoveries.length,1);
  assert.equal(JSON.parse(fs.readFileSync(second.run_snapshot_file)).discoveries.length,2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(first.run_dir,'report.json'))).run_id,first.run_id);
});
const priorSuccess=()=>({uid:'111',code:0,http_status:200,checked_at:'2026-11-10T00:00:00.000Z',scope:'公开投稿列表第1页',last_page:1,reached_end:false,url:'posts:111'});

for(const [status,code] of [[412,-403],[200,-403]]){
  test(`受限 HTTP ${status}/code ${code} 保留成功范围，并对最新失败退避`,async ctx=>{
    const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
    const previous=priorSuccess();
    writeJson(stateFile(t),{...emptyState(),accounts:[previous]});
    const opts={...runOptions(t,['111']),fetch:async()=>jsonResponse({code},status)};
    const report=await runIncremental(opts);
    const state=loadState(stateFile(t),t),account=state.accounts[0];
    assert.equal(account.code,code);
    assert.equal(account.http_status,status);
    assert.equal(account.last_success_at,previous.checked_at);
    assert.equal(account.last_success_range.last_page,1);
    assert.equal(report.last_success_ranges['111'].last_success_at,previous.checked_at);
    assert.equal(report.last_success_ranges['111'].code,code);
    assert.equal(state.failures['posts:111'].consecutive_failures,1);
    const retry=await runIncremental({...opts,fetch:async()=>{assert.fail('退避前不能再请求');}});
    assert.equal(retry.outcome,'deferred');
    assert.equal(retry.sources_checked,0);
    assert.equal(retry.partial,true);
  });
}

test('资源上限不足时标记 partial，零预算报告 incomplete',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  writeJson(stateFile(t),emptyState());
  const opts={...runOptions(t,['111','222']),fetch:postsMock(()=>[])};
  const partial=await runIncremental({...opts,maxRequests:1});
  assert.equal(partial.outcome,'partial');
  assert.equal(partial.partial,true);
  assert.equal(partial.sources_skipped_limit,1);
  const zero=await runIncremental({...opts,maxRequests:0});
  assert.equal(zero.outcome,'incomplete');
  assert.equal(zero.partial,true);
  assert.equal(zero.requests_made,0);
  assert.equal(zero.sources_skipped_limit,2);
});

test('状态在获取锁后读取，保留获取锁之前刚写入的进度',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  writeJson(stateFile(t),emptyState());
  const updated={...emptyState(),discoveries:[{bvid:'BVFRESHSTATE',creator_uid:'111',source:'prior'}]};
  const originalOpen=fs.openSync;
  ctx.mock.method(fs,'openSync',function(file,flags,...args){
    const fd=originalOpen.call(this,file,flags,...args);
    if(file===stateFile(t)+'.lock'&&flags==='wx')writeJson(stateFile(t),updated);
    return fd;
  });
  await runIncremental({...runOptions(t,['111']),fetch:postsMock(()=>[])});
  assert.equal(loadState(stateFile(t),t).discoveries[0]?.bvid,'BVFRESHSTATE');
});

test('fetch 初始化异常时释放已获取的锁',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  writeJson(stateFile(t),emptyState());
  const opts=runOptions(t,['111']);
  Object.defineProperty(opts,'fetch',{get(){
    assert.ok(fs.existsSync(stateFile(t)+'.lock'));
    throw new Error('fetch setup failed');
  }});
  await assert.rejects(runIncremental(opts),/fetch setup failed/);
  assert.equal(fs.existsSync(stateFile(t)+'.lock'),false);
});

test('父目录不存在时初始化状态与快照，不写运行原始文件进仓库',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const persistent=path.join(t,'agent','nested','incremental-state.json');
  const report=await runIncremental({...runOptions(t,['111']),state:persistent,runsDir:path.join(t,'agent','runs'),fetch:postsMock(()=>[])});
  assert.notEqual(report.outcome,'locked');
  assert.ok(fs.existsSync(persistent));
  const snapshot=JSON.parse(fs.readFileSync(path.join(t,'content/inventory/incremental-state.json'),'utf8'));
  assert.equal('failures' in snapshot,false);
  assert.equal(fs.existsSync(path.join(t,'content/inventory/runs')),false);
  assert.equal(fs.existsSync(persistent+'.lock'),false);
});

test('FOODMAP_AGENT_STATE_DIR 跨 checkout 持久化，快照只含可构建证据',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const original=process.env.FOODMAP_AGENT_STATE_DIR;
  process.env.FOODMAP_AGENT_STATE_DIR=path.join(t,'persistent');
  ctx.after(()=>{if(original===undefined)delete process.env.FOODMAP_AGENT_STATE_DIR;else process.env.FOODMAP_AGENT_STATE_DIR=original;});
  const first=path.join(t,'checkout-a'),second=path.join(t,'checkout-b');
  const options={seed:tinySeed(['111']),ledger:tinyLedger(['111']),fetch:postsMock(()=>[{bvid:'BVAAAAAAAAAA',title:'新线索',created:1700000000,mid:'111'}])};
  const report=await runIncremental({...options,root:first});
  assert.equal(report.new_candidates.length,1);
  assert.ok(fs.existsSync(path.join(t,'persistent','incremental-state.json')));
  const again=await runIncremental({...options,root:second});
  assert.equal(again.new_candidates.length,0);
  const snapshot=JSON.parse(fs.readFileSync(path.join(second,'content/inventory/incremental-state.json'),'utf8'));
  assert.equal(snapshot.discoveries.length,1);
  assert.equal('failures' in snapshot,false);
  assert.equal(fs.existsSync(path.join(first,'content/inventory/runs')),false);
});

test('无官方合集的 view 成功后登记已核实作者的视频，下一轮不重复请求',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  writeJson(stateFile(t),emptyState());
  const video={bvid:'BVAAAAAAAAAA',creator_uid:'111',sources:['candidate_samples']};
  const options={...runOptions(t,['111']),seed:{...tinySeed(['111']),videos:[video]},fetch:postsMock(()=>[])};
  const first=await runIncremental(options);
  assert.equal(first.discovered_total,1);
  const state=loadState(stateFile(t),t);
  assert.equal(state.discoveries[0].bvid,video.bvid);
  assert.equal(state.discoveries[0].owner_verified,true);
  assert.equal(first.pending_total,1);
  const second=await runIncremental({...options,fetch:async url=>{
    assert.ok(!url.includes('/view'),'已发现普通视频不应重复请求 view');
    return jsonResponse({code:0,data:{list:{vlist:[]}}});
  }});
  assert.equal(second.requests_made,1);
});

test('view 作者不匹配时保留未核实标志，不计入新增待核',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  writeJson(stateFile(t),emptyState());
  const report=await runIncremental({...runOptions(t,['111']),seed:{...tinySeed(['111']),videos:[{bvid:'BVAAAAAAAAAA',creator_uid:'111',sources:['candidate_samples']}]},fetch:async url=>jsonResponse(url.includes('/view')?{code:0,data:{owner:{mid:222},title:'other',pubdate:1700000000}}:{code:0,data:{list:{vlist:[]}}})});
  assert.equal(loadState(stateFile(t),t).discoveries[0]?.owner_verified,false);
  assert.equal((loadState(stateFile(t),t).videos||[]).length,0,'不保存作者不匹配的元数据');
  assert.equal(report.pending_total,0);
});

test('受限 view 写入退避记录',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  writeJson(stateFile(t),emptyState());
  await runIncremental({...runOptions(t),seed:{creators:[],videos:[{bvid:'BVAAAAAAAAAA',sources:['candidate_samples']}]},fetch:async()=>jsonResponse({code:-403},412)});
  assert.equal(loadState(stateFile(t),t).failures['view:BVAAAAAAAAAA']?.consecutive_failures,1);
});

test('已发现全部候选后，每轮优先检查固定王波合集入口并登记新分集',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const uid='3546728118618546',anchor='BV1NG6kYTEXG';
  writeJson(stateFile(t),{...emptyState(),discoveries:[{bvid:anchor,creator_uid:uid,source:'prior'}]});
  let run=0;const calls=[];
  const options={...runOptions(t,[uid]),maxRequests:1,fetch:async url=>{
    calls.push(url);
    if(url.includes('/view'))return jsonResponse({code:0,data:{owner:{mid:uid},title:'合集入口',pubdate:1700000000,ugc_season:{id:5780378,mid:uid,title:'北京探店',ep_count:run+1,sections:[{episodes:Array.from({length:run+1},(_,i)=>({bvid:'BVSEASON000'+i,arc:{title:'分集'+i,pubdate:1700000000,author:{mid:uid}}}))}]}}});
    return jsonResponse({code:0,data:{list:{vlist:[]}}});
  }};
  const first=await runIncremental(options);
  assert.equal(calls[0].includes('bvid='+anchor),true,'固定合集应优先于投稿列表，不被小预算挤掉');
  assert.equal(first.new_candidates.length,1);
  run++;
  const second=await runIncremental(options);
  assert.equal(calls.filter(u=>u.includes('bvid='+anchor)).length,2);
  assert.equal(second.new_candidates.length,1);
  assert.equal(second.new_candidates[0].bvid,'BVSEASON0001');
  assert.equal(loadState(stateFile(t),t).seasons[0].obtained,2);
});

for(const raw of ['{broken','null',JSON.stringify({...emptyState(),discoveries:{}})]){
  test('损坏状态应报错并保留原文件：'+raw.slice(0,18),async ctx=>{
    const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
    fs.writeFileSync(stateFile(t),raw);
    await assert.rejects(runIncremental({...runOptions(t,['111']),fetch:postsMock(()=>[])}),/invalid incremental state/i);
    assert.equal(fs.readFileSync(stateFile(t),'utf8'),raw);
    assert.equal(fs.existsSync(stateFile(t)+'.lock'),false);
    assert.equal(fs.existsSync(runsDir(t)),false);
  });
}

test('执行超过陈旧窗口但 PID 仍存活的锁不能被抢占',ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const file=stateFile(t)+'.lock';
  fs.writeFileSync(file,String(process.pid)+'\n');
  fs.utimesSync(file,new Date(0),new Date(0));
  const {acquireLock}=require('../scripts/refresh-creator-inventory-incremental.cjs');
  assert.equal(acquireLock(file,1).held,false);
  assert.equal(fs.readFileSync(file,'utf8'),String(process.pid)+'\n');
});

test('成功 view 元数据跨轮持久化，后续受限不覆盖最后成功数据',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const uid='3546728118618546',bvid='BV1NG6kYTEXG';
  writeJson(stateFile(t),emptyState());
  let restricted=false;
  const options={...runOptions(t,[uid]),fetch:async url=>jsonResponse(url.includes('/view')?(restricted?{code:-403}:{code:0,data:{owner:{mid:uid},title:'可信新元数据',pubdate:1700000000,duration:90,season_id:5780378}}):{code:0,data:{list:{vlist:[]}}})};
  await runIncremental(options);
  const first=(loadState(stateFile(t),t).videos||[]).find(v=>v.bvid===bvid);
  assert.ok(first,'成功 view 的元数据应保存到 state.videos');
  assert.equal(first.title,'可信新元数据');
  assert.equal(first.published_at,new Date(1700000000*1000).toISOString());
  assert.equal(first.owner_verified,true);
  restricted=true;
  await runIncremental(options);
  assert.deepEqual(loadState(stateFile(t),t).videos.find(v=>v.bvid===bvid),first);
  const snapshot=JSON.parse(fs.readFileSync(path.join(t,'content/inventory/incremental-state.json'),'utf8'));
  assert.deepEqual(snapshot.videos.find(v=>v.bvid===bvid),first);
});

test('构建合并增量 view 元数据到同一后台台账，待核不公开',ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const inv=path.join(t,'content/inventory');fs.mkdirSync(inv,{recursive:true});fs.mkdirSync(path.join(t,'data'));
  writeJson(path.join(t,'content/config.json'),{creator_uids:['111'],batches:[]});
  writeJson(path.join(t,'data/catalog.json'),{shops:[],visits:[]});
  writeJson(path.join(inv,'video-inventory-2026-11-12.json'),{as_of:'2026-11-12',...tinySeed(['111'])});
  const bvid='BVAAAAAAAAAA';
  const baseline={bvid,code:0,http_status:200,owner_uid:'111',title:'旧元数据',published_at:'2026-01-01T00:00:00.000Z',checked_at:'2026-01-02T00:00:00.000Z',url:'https://api.bilibili.com/x/web-interface/view?bvid='+bvid};
  writeJson(path.join(inv,'access-2026-11-15.json'),{checked_at:baseline.checked_at,accounts:[],seasons:[],discoveries:[],videos:[baseline]});
  const inc={...emptyState(),updated_at:'2026-11-16T00:00:00.000Z',discoveries:[{bvid,creator_uid:'111',owner_verified:true,source:baseline.url}],videos:[{...baseline,title:'增量最新标题',published_at:'2026-11-15T00:00:00.000Z',checked_at:'2026-11-16T00:00:00.000Z',owner_verified:true}]};
  writeJson(path.join(inv,'incremental-state.json'),inc);
  const {buildContent}=require('../scripts/build-content.cjs');
  const result=buildContent(t);
  let v=JSON.parse(fs.readFileSync(path.join(t,'content/compiled.json'),'utf8')).ledger.videos[0];
  assert.equal(v.title,'增量最新标题');
  assert.equal(v.bilibili_published_at,inc.videos[0].published_at);
  assert.equal(v.status,'pending');
  assert.equal(result.approved,0);
  // A failed increment cannot replace successful frozen view metadata either.
  writeJson(path.join(inv,'incremental-state.json'),{...inc,videos:[{bvid,code:-403,http_status:412,checked_at:'2026-11-17T00:00:00.000Z'}]});
  buildContent(t);
  v=JSON.parse(fs.readFileSync(path.join(t,'content/compiled.json'),'utf8')).ledger.videos[0];
  assert.equal(v.title,baseline.title);
  assert.equal(v.bilibili_published_at,baseline.published_at);
});

test('默认状态目录在用户 home；dry-run 不初始化目录或快照',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const original=process.env.FOODMAP_AGENT_STATE_DIR;delete process.env.FOODMAP_AGENT_STATE_DIR;
  ctx.after(()=>{if(original!==undefined)process.env.FOODMAP_AGENT_STATE_DIR=original;});
  const report=await runIncremental({root:t,seed:tinySeed(['111']),ledger:tinyLedger(['111']),dryRun:true});
  assert.equal(report.state_file,path.join(os.homedir(),'foodmap-agent-state/incremental-state.json'));
  assert.equal(report.runs_dir,path.join(os.homedir(),'foodmap-agent-state/runs'));
  assert.equal(fs.existsSync(path.join(t,'content')),false);
});

test('投稿接口缺少列表不能当成成功的零视频',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const account=priorSuccess();writeJson(stateFile(t),{...emptyState(),accounts:[account]});
  const report=await runIncremental({...runOptions(t,['111']),fetch:async()=>jsonResponse({code:0,data:{}})});
  assert.equal(report.sources_ok,0);
  assert.equal(report.sources_failed,1);
  assert.equal(report.outcome,'failed');
  assert.equal(loadState(stateFile(t),t).accounts[0].last_success_at,account.checked_at);
});

test('非成功 HTTP 即使返回 code 0 也不能覆盖最后成功范围',async ctx=>{
  const t=tmp();ctx.after(()=>fs.rmSync(t,{recursive:true,force:true}));
  const account=priorSuccess();writeJson(stateFile(t),{...emptyState(),accounts:[account]});
  const report=await runIncremental({...runOptions(t,['111']),fetch:async()=>jsonResponse({code:0,data:{list:{vlist:[]}}},412)});
  assert.equal(report.sources_ok,0);
  assert.equal(report.sources_restricted,1);
  assert.equal(loadState(stateFile(t),t).accounts[0].last_success_at,account.checked_at);
});
