const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),crypto=require('node:crypto');
const {targets,checkFrame}=require('./scripts/screenshots.cjs');
const {baselineRecords}=require('./content/baseline.cjs');
const {createHandler}=require('./beijing-food-map/amap-handler.cjs');
const entries=require('./content/baseline-screenshots.json'),base=require('./data/catalog.json');
test('11 家公开门店均有对应到访的真实截图，图片字节、详情来源与时间一致',async()=>{
  const handler=createHandler();
  const catalog=await(await handler(new Request('https://test/api/home/catalog'))).json();
  assert.equal(catalog.shops.length,11);
  assert.equal(new Set(catalog.shops.map(s=>s.image.url)).size,11);
  for(const s of catalog.shops){
    assert.equal(s.image.kind,'video_screenshot');assert.equal(s.image.source,s.video);assert.ok(s.image.frame_verified);
    const response=await handler(new Request(new URL(s.image.url,'https://test')));assert.equal(response.status,200);
    assert.equal(crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'),s.image.sha256);
    const d=await(await handler(new Request('https://test/api/content?visit_id='+encodeURIComponent(s.featured_visit_id)))).json();
    assert.equal(d.records.length,1);const r=d.records[0];assert.equal(r.video.url,s.video);
    assert.equal(r.visit.screenshots[0].timestamp_ms,s.image.timestamp_ms);assert.equal(r.video.part,s.image.part);
    assert.equal(new URL(r.player_url).searchParams.get('bvid'),r.video.bvid);
  }
});
test('导入拒绝错 BV、错分 P、越界时间、坏哈希及未解码画面',()=>{
  const frame=require('./evidence/screenshots/capture-manifest.json').frames[0],target=targets().find(t=>t.visit_id===frame.visit_id),bytes=fs.readFileSync('content/images/'+frame.file);
  checkFrame(frame,target,bytes);
  for(const patch of [{bvid:'BV1AdqYYNEDM'},{part:2},{timestamp_ms:-1},{timestamp_ms:1e9},{sha256:'0'.repeat(64)},{readyState:0},{current_seconds:NaN}])assert.throws(()=>checkFrame({...frame,...patch},target,bytes));
});
test('补图不能新增门店、篡改到访归属、重复导入或提升未核准分店',()=>{
  assert.equal(baselineRecords(base,entries).length,10);
  for(const patch of [{visit_id:'missing'},{store_id:'beijing-99'},{part:2},{bvid:'BV1AdqYYNEDM'}])assert.throws(()=>baselineRecords(base,[{...entries[0],...patch}]));
  assert.throws(()=>baselineRecords(base,[entries[0],entries[0]]));
  const unverified=structuredClone(base);unverified.shops.find(s=>s.id===entries[0].store_id).verification='pending';assert.throws(()=>baselineRecords(unverified,[entries[0]]));
});
