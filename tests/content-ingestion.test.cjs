'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {pathToFileURL}=require('node:url');
const {build}=require('esbuild');
const {buildLedger}=require('../content/ledger.cjs');
const runtime=require('../content/runtime.cjs');
const UID=runtime.ledger.creators[0].uid;
const OTHER_UID=runtime.ledger.creators[1].uid;
const TOKEN='acceptance-ingest-token';
const NOW='2026-11-16T08:00:00.000Z';
const BEFORE='2026-11-15T08:00:00.000Z';
const view=bvid=>`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
const posts=uid=>`https://api.bilibili.com/x/space/wbi/arc/search?mid=${uid}&pn=1&ps=30`;
const discovery=(bvid='BV1NEWTEST01',overrides={})=>({bvid,creator_uid:UID,title:'新增官方候选',published_at:'2026-11-14T03:00:00.000Z',discovered_at:NOW,owner_verified:true,source:view(bvid),...overrides});
const snapshot=(discoveries=[],overrides={})=>({schema:1,updated_at:NOW,discoveries,accounts:[],seasons:[],videos:[],...overrides});
const request=(route='/api/admin/content-ingest',method='GET',body,headers={})=>new Request('https://foodmap.test'+route,{method,headers:{Authorization:'Bearer '+TOKEN,...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
const env=bucket=>({FOODMAP_INGEST_TOKEN:TOKEN,CONTENT_UPDATES:bucket});
class MemoryR2 {
  constructor(){this.value=null;this.etag=null;this.writes=0;this.conflicts=0;this.reads=0;this.fail=false;}
  async get(key){
    if(key!=='private/content-incremental-v1.json')return null;
    this.reads++;if(this.fail)throw Error('private storage unavailable');
    const value=this.value,etag=this.etag;
    return value===null?null:{key,etag,json:async()=>JSON.parse(value)};
  }
  async put(key,value,options){
    const condition=options.onlyIf;
    const matches=condition instanceof Headers?condition.get('If-None-Match')==='*'&&this.value===null:condition.etagMatches===this.etag;
    if(!matches){this.conflicts++;return null;}
    this.value=value;this.etag='etag-'+(++this.writes);return {key,etag:this.etag};
  }
}
let temp;
const workerPromise=(async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'foodmap-ingestion-test-'));
  const outfile=path.join(temp,'worker.mjs');
  await build({entryPoints:[path.resolve('deployment/worker.mjs')],outfile,bundle:true,platform:'browser',format:'esm',target:'es2022',define:{FOODMAP_RELEASE:'"ingestion-test"'},loader:{'.html':'text'},plugins:[{name:'raw-test-assets',setup(builder){
    builder.onResolve({filter:/\?raw$/},args=>({path:path.resolve(args.resolveDir,args.path.replace(/\?raw$/,'')),namespace:'raw-test-assets'}));
    builder.onLoad({filter:/.*/,namespace:'raw-test-assets'},async args=>({contents:await fs.readFile(args.path,'utf8'),loader:'text'}));
  }}]});
  return (await import(pathToFileURL(outfile).href)).default;
})();
after(async()=>{await workerPromise;await fs.rm(temp,{recursive:true,force:true});});

test('未配置导入令牌或R2时返回503，错误令牌及登录身份不能授权采集',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();
  for(const e of [{},{CONTENT_UPDATES:bucket},{FOODMAP_INGEST_TOKEN:TOKEN}]){
    assert.equal((await worker.fetch(request(undefined,'POST',snapshot()),e)).status,503);
  }
  for(const headers of [{Authorization:''},{Authorization:'Bearer wrong'},{Authorization:'Basic '+TOKEN},{Authorization:'','oai-authenticated-user-id':'visitor'}]){
    const response=await worker.fetch(request(undefined,'POST',snapshot(),headers),env(bucket));
    assert.equal(response.status,401);assert.ok(!(await response.text()).includes(TOKEN));
  }
  assert.equal(bucket.writes,0);
});

test('只接受官方证据字段、当前UID与合法BV，拒绝公开批准或门店载荷',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();
  const invalid=[
    snapshot([discovery(undefined,{creator_uid:'999999999999999'})]),
    snapshot([discovery('bad-BV')]),
    snapshot([discovery(undefined,{owner_verified:false})]),
    snapshot([discovery(undefined,{source:'https://api.bilibili.com.evil.example/view'})]),
    snapshot([discovery(undefined,{source:'http://api.bilibili.com/view'})]),
    snapshot([discovery(undefined,{source:'https://user:password@api.bilibili.com/view'})]),
    snapshot([discovery(undefined,{review:{status:'approved'}})]),
    snapshot([discovery()],{records:[]}),
    snapshot([discovery()],{published:true}),
    snapshot([],{accounts:[{uid:UID,url:posts(UID),checked_at:NOW,code:0,review:'approved'}]}),
    snapshot([],{videos:[{bvid:'BV1NEWTEST01',owner_uid:OTHER_UID,owner_verified:false,checked_at:NOW,url:view('BV1NEWTEST01'),code:0}]}),
    snapshot([],{updated_at:'tomorrow'}),
    '{invalid json'
  ];
  for(const body of invalid){const response=await worker.fetch(request(undefined,'POST',body),env(bucket));assert.equal(response.status,400,JSON.stringify(body));}
  assert.equal(bucket.writes,0);
});

test('实际流式body限2MiB，伪造Content-Length不能绕过上限',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();
  const tooLarge=JSON.stringify(snapshot([discovery(undefined,{title:'字'.repeat(800000)})]));
  for(const headers of [{},{'Content-Length':'1'},{'Content-Length':'3000000'}])assert.equal((await worker.fetch(request(undefined,'POST',tooLarge,headers),env(bucket))).status,413);
  assert.equal(bucket.writes,0);
});

test('导入去重保存最早发现及最新有效元数据，旧上传不倒退且失败保留成功范围',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2(),bvid='BV1NEWTEST01';
  const success={uid:UID,url:posts(UID),checked_at:NOW,http_status:200,code:0,scope:'第1页',last_page:1,obtained:2,reached_end:false,first_bvid:bvid,last_bvid:bvid};
  const metadata={bvid,owner_uid:UID,owner_verified:true,checked_at:NOW,url:view(bvid),http_status:200,code:0,title:'最新官方标题',published_at:'2026-11-14T03:00:00.000Z',duration_seconds:300};
  assert.equal((await worker.fetch(request(undefined,'POST',{snapshot:snapshot([discovery()],{accounts:[success],videos:[metadata],seasons:[{id:5780378,uid:UID,title:'北京探店',total:2,obtained:2,reached_end:true,last_bvid:bvid,source:view(bvid),checked_at:NOW}]}),run:{run_id:'run-new',checked_at:NOW,outcome:'new_candidates',partial:false}}),env(bucket))).status,200);
  const older=snapshot([discovery(bvid,{title:'过期标题',discovered_at:BEFORE})],{updated_at:BEFORE,accounts:[{...success,checked_at:BEFORE,obtained:1}],videos:[{...metadata,checked_at:BEFORE,title:'过期官方标题'}],seasons:[{id:5780378,uid:UID,title:'旧合集',total:1,obtained:1,reached_end:true,last_bvid:bvid,source:view(bvid),checked_at:BEFORE}]});
  assert.equal((await worker.fetch(request(undefined,'POST',{snapshot:older,run:{run_id:'run-old',checked_at:BEFORE,outcome:'no_change',partial:false}}),env(bucket))).status,200);
  const later='2026-11-17T08:00:00.000Z';
  assert.equal((await worker.fetch(request(undefined,'POST',snapshot([],{updated_at:later,accounts:[{uid:UID,url:posts(UID),checked_at:later,http_status:412,code:null,restriction:'HTTP 412'}]})),env(bucket))).status,200);
  const stored=JSON.parse(bucket.value);
  assert.equal(stored.discoveries.length,1);assert.equal(stored.discoveries[0].discovered_at,BEFORE);assert.equal(stored.discoveries[0].title,'新增官方候选');
  assert.equal(stored.videos[0].title,'最新官方标题');assert.equal(stored.seasons[0].obtained,2);
  assert.equal(stored.accounts[0].code,null);assert.equal(stored.accounts[0].last_success_range.obtained,2);assert.equal(stored.accounts[0].last_success_at,NOW);
  const result=await(await worker.fetch(request(),env(bucket))).json();
  assert.equal(result.last_run.run_id,'run-new');assert.equal(result.counts.discoveries,1);assert.equal(result.discovered_count,1);assert.equal(result.revision,3);assert.equal(result.updated_at,later);
});

test('并发条件写重试合并，不丢失同时上传的不同候选',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();
  const results=await Promise.all(['BV1NEWTEST01','BV1NEWTEST02'].map(bvid=>worker.fetch(request(undefined,'POST',snapshot([discovery(bvid)])),env(bucket))));
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  assert.deepEqual(JSON.parse(bucket.value).discoveries.map(d=>d.bvid).sort(),['BV1NEWTEST01','BV1NEWTEST02']);assert.ok(bucket.conflicts>0);
});

test('连续CAS冲突返回409且不会声称导入成功',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();let attempts=0;
  bucket.put=async()=>{attempts++;return null;};
  const response=await worker.fetch(request(undefined,'POST',snapshot([discovery()])),env(bucket));
  assert.equal(response.status,409);assert.equal(attempts,4);assert.equal(bucket.value,null);
});

test('后台下一次请求读取R2，新实例继续可见候选；公开地图和合集无新增',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();
  const publicPaths=['/api/creators','/api/creators/'+UID,'/api/home/catalog','/api/content'];
  const before=await Promise.all(publicPaths.map(async route=>await(await worker.fetch(request(route),env(bucket))).text()));
  const identity={'oai-authenticated-user-id':'visitor'};
  const old=await(await worker.fetch(request('/api/admin/videos?uid='+UID,'GET',undefined,identity),env(bucket))).json();
  await worker.fetch(request(undefined,'POST',snapshot([discovery()])),env(bucket));
  // Re-evaluate the Worker module to prove a new instance reads shared evidence.
  const next=(await import(pathToFileURL(path.join(temp,'worker.mjs')).href+'?fresh-instance')).default;
  const response=await next.fetch(request('/api/admin/videos?uid='+UID+'&status=pending','GET',undefined,identity),env(bucket));
  assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
  const body=await response.json(),candidate=body.videos.find(v=>v.bvid==='BV1NEWTEST01');
  assert.ok(candidate);assert.equal(candidate.status,'pending');assert.deepEqual(candidate.visits,[]);assert.ok(candidate.missing.length);
  const creators=await(await next.fetch(request('/api/admin/creators','GET',undefined,identity),env(bucket))).json();
  assert.equal(creators.creators.find(c=>c.uid===UID).counts.discovered,old.videos.length+1);
  const after=await Promise.all(publicPaths.map(async route=>await(await next.fetch(request(route),env(bucket))).text()));
  assert.deepEqual(after,before);
  const anonymous=await next.fetch(request('/api/admin/videos?uid='+UID,'GET',undefined,{Authorization:''}),env(bucket));assert.equal(anonymous.status,401);assert.ok(!(await anonymous.text()).includes('BV1NEWTEST01'));
});

test('R2配置存在但读取失败或损坏时后台503；无绑定兼容冻结台账',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2(),identity={'oai-authenticated-user-id':'visitor'};
  const route='/api/admin/creators';
  assert.equal((await worker.fetch(request(route,'GET',undefined,identity),{})).status,200);
  bucket.fail=true;
  for(const r of [request(),request(undefined,'POST',snapshot([discovery()])),request(route,'GET',undefined,identity)]){
    const response=await worker.fetch(r,env(bucket));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private storage'));
  }
  assert.equal((await worker.fetch(request('/api/creators'),env(bucket))).status,200);
  bucket.fail=false;bucket.value='{broken';bucket.etag='bad';
  assert.equal((await worker.fetch(request(route,'GET',undefined,identity),env(bucket))).status,503);
});

test('当前发布批次先注册新creator，再合并其发现，不影响发布状态',()=>{
  const record=structuredClone(runtime.records[0]);record.creator={uid:'999333',name:'当前新账号'};
  const seed={as_of:'2026-11-12',creators:[],videos:[]};
  const ledger=buildLedger({snapshot:seed,records:[record],access:{checked_at:NOW,discoveries:[discovery(undefined,{creator_uid:'999333'})]}});
  assert.ok(ledger.videos.find(v=>v.bvid==='BV1NEWTEST01'));assert.equal(ledger.videos.find(v=>v.bvid==='BV1NEWTEST01').status,'pending');
  assert.equal(ledger.videos.find(v=>v.bvid===record.video.bvid).status,record.published?'published':'pending');
});

test('hosting manifest requests the logical R2 binding without storing secrets',async()=>{
  const manifest=JSON.parse(await fs.readFile('.openai/hosting.json','utf8'));
  assert.equal(manifest.r2,'CONTENT_UPDATES');assert.equal(manifest.FOODMAP_INGEST_TOKEN,undefined);
});

test('不同官方来源也保留BV最早发现；后台用新元数据重排已公开历史，公开接口冻结',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2();
  const identity={'oai-authenticated-user-id':'visitor'},bvid='BV1NEWTEST01';
  const early=discovery(bvid,{source:posts(UID),discovered_at:BEFORE,title:'较早来源'});
  const known=runtime.ledger.videos.find(v=>v.status==='published'&&v.creator_uid===UID)||runtime.ledger.videos.find(v=>v.status==='published');
  const rawPublic=await(await worker.fetch(request('/api/creators/'+known.creator_uid),env(bucket))).text();
  const metadata={bvid:known.bvid,owner_uid:known.creator_uid,owner_verified:true,checked_at:NOW,url:view(known.bvid),http_status:200,code:0,title:'新官方元数据标题',published_at:'2026-11-15T03:00:00.000Z'};
  const response=await worker.fetch(request(undefined,'POST',snapshot([discovery(),early],{videos:[metadata]})),env(bucket));
  assert.equal(response.status,200);
  const data=await(await worker.fetch(request('/api/admin/videos','GET',undefined,identity),env(bucket))).json();
  assert.equal(data.videos.find(v=>v.bvid===bvid).discovered_at,BEFORE);
  assert.equal(data.videos.find(v=>v.bvid===known.bvid).title,metadata.title);
  const dates=data.videos.filter(v=>v.bilibili_published_at).map(v=>Date.parse(v.bilibili_published_at));
  assert.deepEqual(dates,[...dates].sort((a,b)=>b-a));
  assert.equal(await(await worker.fetch(request('/api/creators/'+known.creator_uid),env(bucket))).text(),rawPublic);
});

test('已知BV不能转给其他已登记UID；失败的视频元数据不会覆盖成功版本',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2(),bvid='BV1NEWTEST01';
  const good={bvid,owner_uid:UID,owner_verified:true,checked_at:NOW,url:view(bvid),http_status:200,code:0,title:'成功标题'};
  assert.equal((await worker.fetch(request(undefined,'POST',snapshot([discovery()],{videos:[good]})),env(bucket))).status,200);
  assert.equal((await worker.fetch(request(undefined,'POST',snapshot([discovery(bvid,{creator_uid:OTHER_UID})])),env(bucket))).status,400);
  assert.equal((await worker.fetch(request(undefined,'POST',snapshot([],{updated_at:'2026-11-17T08:00:00.000Z',videos:[{...good,checked_at:'2026-11-17T08:00:00.000Z',http_status:412,code:-403,title:null,error:'HTTP 412'}]})),env(bucket))).status,200);
  assert.equal(JSON.parse(bucket.value).videos[0].title,'成功标题');
});

test('后台账号覆盖展示最后成功范围和最新受限检查，失败不清空覆盖',async()=>{
  const worker=await workerPromise,bucket=new MemoryR2(),identity={'oai-authenticated-user-id':'visitor'};
  const success={uid:UID,url:posts(UID),checked_at:NOW,http_status:200,code:0,scope:'公开投稿列表第1页',last_page:1,obtained:2,reached_end:false,first_bvid:'BV1NEWTEST01',last_bvid:'BV1NEWTEST02'};
  await worker.fetch(request(undefined,'POST',snapshot([],{accounts:[success]})),env(bucket));
  const later='2026-11-17T08:00:00.000Z';
  await worker.fetch(request(undefined,'POST',snapshot([],{updated_at:later,accounts:[{uid:UID,url:posts(UID),checked_at:later,code:-403,http_status:412,restriction:'入口受限'}]})),env(bucket));
  const data=await(await worker.fetch(request('/api/admin/creators','GET',undefined,identity),env(bucket))).json();
  const coverage=data.creators.find(c=>c.uid===UID).coverage;
  assert.equal(coverage.status,'restricted');assert.equal(coverage.checked_at,later);assert.equal(coverage.last_success_at,NOW);
  assert.equal(coverage.last_success_range.obtained,2);assert.equal(coverage.scope,success.scope);assert.equal(coverage.stop,success.last_bvid);assert.equal(coverage.account_history_complete,false);
});
