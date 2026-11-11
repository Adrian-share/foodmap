const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {once}=require('node:events');
const {fixture,record}=require('./tests/fixtures/content.cjs');
const {buildContent}=require('./scripts/build-content.cjs');
const {createContentState}=require('./content/state.cjs');
const {buildCatalog,visitKey}=require('./content/catalog.cjs');
const {createNearbyService}=require('./nearby.cjs');
const {createHandler}=require('./beijing-food-map/amap-handler.cjs');
const {createServer}=require('./amap-server.cjs');
const {Client}=require('@modelcontextprotocol/client');
const {StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');

test('两个批次与新增 UID 实际构建、重导、撤批、哈希损坏和冲突',t=>{
  fs.mkdirSync('test-results',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('test-results/content-import-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const dir of ['content/batches','content/images','data'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.copyFileSync('data/catalog.json',path.join(root,'data/catalog.json'));
  const f=fixture();
  const config={...f.config,batches:f.batches.map(b=>({path:'batches/'+b.batch_id+'.json',enabled:true}))};
  const writeConfig=()=>fs.writeFileSync(path.join(root,'content/config.json'),JSON.stringify(config));
  const writeBatch=b=>fs.writeFileSync(path.join(root,'content/batches/'+b.batch_id+'.json'),JSON.stringify(b));
  f.batches.forEach(writeBatch);writeConfig();fs.writeFileSync(path.join(root,'content/images/contract-test.png'),f.bytes);
  const a=buildContent(root);assert.equal(a.approved,3);assert.equal(a.shops,2);
  config.batches.push(config.batches[0]);writeConfig();assert.deepEqual(buildContent(root),a);
  config.batches.pop();config.batches.reverse();writeConfig();assert.deepEqual(buildContent(root),a);
  const snapshot=()=>JSON.parse(fs.readFileSync(path.join(root,'content/compiled.json')));
  const state=createContentState(snapshot(),f.images);assert.equal(state.catalog.creators.length,2);
  config.creator_uids.pop();writeConfig();const withoutAuthor=buildContent(root);assert.equal(withoutAuthor.approved,2);assert.notEqual(withoutAuthor.version,a.version);
  config.creator_uids=f.config.creator_uids;config.batches.find(b=>b.path.includes('contract-b')).enabled=false;writeConfig();assert.equal(buildContent(root).approved,2);
  config.batches.forEach(b=>b.enabled=true);writeConfig();
  fs.writeFileSync(path.join(root,'content/images/contract-test.png'),'corrupt');assert.throws(()=>buildContent(root),/哈希/);
  fs.writeFileSync(path.join(root,'content/images/contract-test.png'),f.bytes);
  f.batches[1].records.push({...structuredClone(f.batches[0].records[0]),review:{status:'pending'}});writeBatch(f.batches[1]);assert.throws(()=>buildContent(root),/到访 ID 冲突/);
});

test('旧门店按显式 POI 映射合并，保留旧到访和两个新到访',async()=>{
  const f=fixture();f.config.store_aliases={'TEST-NEW':'beijing-5'};
  const catalog=buildCatalog(f.batches,()=>true,f.config);
  const data=await createNearbyService({dataset:'verified',contentCatalog:catalog}).query({location:'北京王府井地铁站'});
  const shop=data.results.find(s=>s.id==='beijing-5');assert.ok(shop);assert.equal(shop.visits.length,3);
  assert.ok(!data.results.some(s=>s.id==='amap:TEST-NEW'));assert.equal(shop.meters,0);
  assert.equal(new Set(shop.visits.map(v=>v.id)).size,3);
});

test('Worker、Node HTTP、真实 MCP 协议的版本、店序、距离和到访一致',async t=>{
  const f=fixture(),server=createServer({dataset:'verified',contentState:f.state,publicBaseUrl:'https://preview.test'});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port;
  const worker=createHandler({contentState:f.state,mode:'fixture',dataset:'verified'});
  const web=await(await worker(new Request('https://preview.test/api/nearby?location=北京王府井地铁站'))).json();
  const http=await(await fetch(url+'/api/nearby?location=北京王府井地铁站')).json();
  const client=new Client({name:'contract-test',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(url+'/mcp')));t.after(()=>client.close());
  const result=await client.callTool({name:'find_nearby_food',arguments:{location:'北京王府井地铁站'}});
  assert.ok(!result.isError);const mcp=result.structuredContent;
  for(const data of [http,mcp]){
    assert.equal(data.data_version,web.data_version);assert.deepEqual(data.origin,web.origin);
    assert.deepEqual(data.results.map(s=>[s.id,s.meters,s.visits,s.card]),web.results.map(s=>[s.id,s.meters,s.visits,s.card]));
  }
  const shop=web.results.find(s=>s.id==='amap:TEST-NEW');assert.equal(shop.visits.length,2);
  assert.equal(shop.card.video.url,shop.card.image.source);assert.equal(shop.card.description.source_video,shop.video);
  assert.equal(shop.card.visit_id,shop.featured_visit_id);assert.equal(shop.card.image.kind,'video_screenshot');
  assert.ok(result.content.some(c=>c.type==='image'&&c.data===f.images['/content/images/contract-test.png'].base64));
  const exact=await(await worker(new Request('https://preview.test/api/content?visit_id='+encodeURIComponent(visitKey(f.batches[0].records[1]))))).json();
  assert.equal(exact.records.length,1);assert.equal(exact.records[0].visit.branch_name,'TEST-BRANCH');
  const player=new URL(exact.records[0].player_url);assert.equal(player.searchParams.get('p'),'2');assert.equal(player.searchParams.get('t'),'50');
  const image=await worker(new Request(shop.image.url));assert.equal(image.status,200);assert.deepEqual(Buffer.from(await image.arrayBuffer()),f.bytes);
  assert.equal((await worker(new Request('https://preview.test/api/content?visit_id=missing'))).status,404);
  const review=await(await worker(new Request('https://preview.test/api/content?review=1'))).json();assert.equal(review.batches.length,2);assert.ok(review.records.every(r=>r.visit.screenshots.length===0));
  assert.equal((await worker(new Request('https://preview.test/mcp',{method:'POST'}))).status,405);
});

test('未启用 UID、缺失文件、缺少到访 ID 和未知时长不能进入公开列表',()=>{
  const f=fixture();const r=record({uid:'888888'});
  assert.equal(buildCatalog([{...f.batches[0],records:[r]}],()=>true,f.config).visits.length,0);
  for(const change of [r=>r.visit.id=null,r=>r.video.duration_seconds=null]){
    const r=record();change(r);assert.equal(buildCatalog([{...f.batches[0],records:[r]}],()=>true,f.config).visits.length,0);
  }
  const s=createContentState({config:f.config,batches:f.batches},{});assert.equal(s.catalog.visits.length,0);
  assert.ok(s.records.every(r=>r.publication_reasons.some(reason=>reason.includes('文件'))));
});
