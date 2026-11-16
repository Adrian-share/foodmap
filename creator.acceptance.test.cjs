const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const snapshot=JSON.parse(fs.readFileSync('content/inventory/video-inventory-2026-11-12.json','utf8'));
const {createContentHandler}=require('./content/http.cjs');
const readAsset=f=>fs.readFileSync(f);
const request=(path,headers={})=>new Request('https://foodmap.test'+path,{headers});
const identity={'oai-authenticated-user-id':'acceptance-visitor'};

test('C1 全部既有UID和视频线索可对账，统计由唯一BV/分店重新计算',()=>{
 const {buildLedger}=require('./content/ledger.cjs');
 const state=require('./content/runtime.cjs');
 const ledger=buildLedger({snapshot,records:state.records});
 assert.ok(ledger.creators.length>=18);assert.ok(ledger.videos.length>=92);
 for(const c of ledger.creators){
  const vs=ledger.videos.filter(v=>v.creator_uid===c.uid);
  assert.equal(c.counts.discovered,vs.length);
  assert.equal(c.counts.discovered,c.counts.published+c.counts.pending+c.counts.excluded);
  assert.equal(c.counts.searchable_stores,new Set(vs.flatMap(v=>v.visits.filter(v=>v.published).map(v=>v.store_id))).size);
  assert.ok(c.coverage.scope);assert.ok(c.coverage.stop);assert.ok(c.coverage.checked_at);assert.equal(c.coverage.account_history_complete,false);
 }
 assert.ok(ledger.creators.find(c=>c.uid==='3546728118618546').counts.discovered>=61);
 assert.equal(new Set(ledger.videos.map(v=>v.bvid)).size,ledger.videos.length);
 assert.ok(ledger.videos.every(v=>v.sources.length&&v.discovered_at));
});

test('C1/C3 当前批次覆盖快照旧状态，重复来源不增加计数',()=>{
 const {buildLedger}=require('./content/ledger.cjs');
 const r=structuredClone(require('./content/runtime.cjs').records.find(r=>r.video.bvid==='BV1AdqYYNEDM'));
 r.video.bvid='BV1NG6kYTEXG';r.video.url='https://www.bilibili.com/video/BV1NG6kYTEXG/';r.visit_id='new-approved';
 const a=buildLedger({snapshot,records:[r,r]});const v=a.videos.find(v=>v.bvid===r.video.bvid);
 assert.equal(v.status,'published');assert.equal(v.visits.length,1);
 assert.equal(a.videos.length,90);assert.ok(v.sources.some(s=>s.includes('snapshot')));
 const c=a.creators.find(c=>c.uid===r.creator.uid);assert.equal(c.counts.published,1);
 assert.equal(c.counts.discovered,c.counts.published+c.counts.pending+c.counts.excluded);
 // Snapshot publication is historical evidence, never permission to publish a removed visit.
 assert.equal(a.videos.find(v=>v.bvid==='BV1AdqYYNEDM').status,'pending');
});

test('C1 后续访问失败保留已有发现及成功覆盖范围，重盘不改首次登记时间',()=>{
 const {mergeDiscoveryEvidence}=require('./scripts/refresh-creator-inventory.cjs');
 const v={bvid:'BV1NG6kYTEXG',creator_uid:'3546728118618546',source:'official-season',discovered_at:'2026-11-11T00:00:00Z'};
 const before={discoveries:[v],seasons:[{id:5780378,obtained:61,checked_at:'2026-11-11'}]};
 const failed=mergeDiscoveryEvidence(before,{accounts:[{uid:v.creator_uid,http_status:412}],discoveries:[],seasons:[]});
 assert.deepEqual(failed.discoveries,[v]);assert.deepEqual(failed.seasons,before.seasons);
 const repeated=mergeDiscoveryEvidence(failed,{discoveries:[{...v,discovered_at:'2026-11-15T00:00:00Z'}],seasons:[{id:5780378,obtained:62,checked_at:'2026-11-15'}]});
 assert.equal(repeated.discoveries.length,1);assert.equal(repeated.discoveries[0].discovered_at,v.discovered_at);assert.equal(repeated.seasons[0].obtained,62);
});

test('C2 后台页面跳登录，API拒绝匿名，review参数不能绕过；私有响应禁止缓存',async()=>{
 const handle=createContentHandler({readAsset});
 const page=await handle(request('/admin/creators/?uid=3546728118618546'));
 assert.equal(page.status,302);assert.match(page.headers.get('location'),/^\/signin-with-chatgpt\?returnTo=/);
 for(const path of ['/api/admin/creators','/api/admin/videos?uid=3546728118618546','/api/content?review=1']){
  const r=await handle(request(path));assert.equal(r.status,401);assert.match(r.headers.get('cache-control'),/no-store/);
  assert.ok(!(await r.text()).includes('BV1NG6kYTEXG'));
 }
 const r=await handle(request('/api/admin/creators',identity));assert.equal(r.status,200);
 assert.match(r.headers.get('vary'),/oai-authenticated-user-id/i);assert.equal((await r.json()).creators.length,require('./content/runtime.cjs').ledger.creators.length);
 const videos=await(await handle(request('/api/admin/videos?uid=3546728118618546&status=pending',identity))).json();
 assert.ok(videos.videos.length>0);assert.ok(videos.videos.every(v=>v.creator_uid==='3546728118618546'&&v.status==='pending'&&v.missing.length));
 assert.equal((await handle(new Request('https://foodmap.test/api/admin/creators',{method:'POST',headers:identity}))).status,405);
});

test('C4 公开合集只含已公开北京视频、按B站发稿倒序、保留未知日期及所有分店',async()=>{
 const handle=createContentHandler({readAsset});
 const creators=await(await handle(request('/api/creators'))).json();assert.ok(creators.creators.length>=4);
 assert.ok(creators.creators.every(c=>!c.coverage&&!c.selection_status));
 for(const c of creators.creators){
  const data=await(await handle(request('/api/creators/'+c.uid))).json();
  assert.ok(data.videos.length);assert.ok(data.videos.every(v=>v.status==='published'&&v.visits.every(v=>v.published)));
  const dates=data.videos.filter(v=>v.bilibili_published_at).map(v=>v.bilibili_published_at);assert.deepEqual(dates,[...dates].sort().reverse());
  for(const v of data.videos)for(const visit of v.visits){assert.match(visit.map_url,/store_id=/);assert.match(visit.detail_url,/visit_id=/);assert.match(visit.player_url,/player.bilibili.com/);}
 }
 assert.equal((await handle(request('/api/creators/403082144'))).status,404);
 assert.equal((await handle(request('/creators/'))).status,200);
});

test('B2 东坝和大钟寺新增分店有同次到访原图、距离和公开合集',async()=>{
 const {createHandler}=require('./beijing-food-map/amap-handler.cjs');
 const handle=createHandler({readAsset});
 for(const [location,id,uid,bvid] of [
  ['东坝','amap:B0MAY526GQ','24159340','BV1k94y1H7fc'],
  ['大钟寺','amap:B000A84BGQ','2087495384','BV1aLW9zLEup']
 ]){
  const nearby=await(await handle(request('/api/nearby?city=北京&location='+location+'&creator='+uid+'&limit=50'))).json();
  assert.equal(nearby.status,'ok');
  assert.equal(nearby.results.filter(s=>s.id===id).length,1);
  const store=nearby.results.find(s=>s.id===id);
  assert.ok(Number.isFinite(store.meters));
  assert.equal(store.card.creator.uid,uid);
  assert.equal(store.card.image.kind,'video_screenshot');
  assert.equal(store.card.video.bvid,bvid);
  assert.ok(store.card.description.text);
  assert.equal((await handle(request(new URL(store.card.image.url).pathname))).headers.get('content-type'),'image/jpeg');
  const detail=await(await handle(request('/api/content?visit_id='+encodeURIComponent(store.card.visit_id)))).json();
  assert.equal(detail.records[0].video.bvid,bvid);
  const collection=await(await handle(request('/api/creators/'+uid))).json();
  assert.ok(collection.videos.some(v=>v.bvid===bvid));
 }
});
