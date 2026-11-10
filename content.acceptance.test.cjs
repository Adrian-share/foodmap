const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assess,buildCatalog,playerUrl,publicRecords}=require('./content/catalog.cjs');
const batch=require('./content/batches/beijing-pilot-001.json');
const clone=x=>structuredClone(x);
function ready(){
  const r=clone(batch.records[0]);
  Object.assign(r.visit,{id:'visit-1',store_id:'amap:B000TEST',branch_name:'测试分店',city:'北京市',district:'东城区',address:'测试地址',amap_poi_id:'B000TEST',amap_url:'https://ditu.amap.com/place/B000TEST',gcj02:{lng:116.4,lat:39.9},business_status:'open',start_seconds:10,end_seconds:30});
  r.visit.evidence.push({type:'branch',status:'verified',url:r.video.url,seconds:10},{type:'amap',status:'verified',url:r.visit.amap_url});
  r.visit.screenshots=[{path:'content/images/test.webp',source_video:r.video.url,part:1,timestamp_ms:10000,alt:'测试门头',usage_basis:'创作者书面许可：fixture',rights_status:'approved',frame_verified:true,sha256:'a'.repeat(64)}];
  r.review.status='approved';return r;
}
test('C01 九条有可回查结论，三位实际作者 UID 与候选匹配',()=>{
  assert.equal(batch.records.length,9);assert.equal(new Set(batch.records.map(r=>r.creator.uid)).size,3);
  for(const r of batch.records){assert.equal(r.video.owner_uid,r.creator.uid);assert.equal(r.video.metadata_status,'verified');assert.ok(r.review.reasons.length);assert.ok(['pending','missing_screenshot','excluded','approved'].includes(r.review.status));}
});
test('C02 未核准分店、异地、未知营业状态不发布；已核准者可入库',()=>{
  const r=ready();assert.deepEqual(assess(r),[]);
  for(const patch of [{city:'上海市'},{branch_name:null},{gcj02:null},{business_status:'unknown'},{gcj02:{lng:121.49,lat:31.23}}]){const x=clone(r);Object.assign(x.visit,patch);assert.ok(assess(x).length);}
  const x=clone(r);x.video.owner_uid='123';assert.ok(assess(x).length);
});
test('C03 缺图、来源不符、错分 P、错时间、无授权均不发布',()=>{
  const r=ready();
  for(const patch of [{usage_basis:null},{rights_status:'pending'},{source_video:'https://www.bilibili.com/video/BV1ao4y1k75R/'},{part:2},{timestamp_ms:50000},{frame_verified:false},{path:'../private.jpg'},{sha256:null}]){const x=clone(r);Object.assign(x.visit.screenshots[0],patch);assert.ok(assess(x).length);}
  const x=clone(r);x.visit.screenshots=[];assert.ok(assess(x).length);
});
test('C04 官方播放器携带 BV、分 P、时间点，默认不自动播放',()=>{
  const r=ready();r.video.part=2;const u=new URL(playerUrl(r));assert.equal(u.origin,'https://player.bilibili.com');assert.equal(u.pathname,'/player.html');assert.equal(u.searchParams.get('bvid'),r.video.bvid);assert.equal(u.searchParams.get('p'),'2');assert.equal(u.searchParams.get('t'),'10');assert.equal(u.searchParams.get('autoplay'),'0');
  assert.throws(()=>playerUrl({...r,video:{bvid:'javascript:alert(1)'}}));
});
test('C05 本批未核卡片均不进入公开列表，文件实存检查不可省略',()=>{
  assert.equal(publicRecords(batch.records).length,0);assert.equal(publicRecords([ready()],()=>false).length,0);assert.equal(publicRecords([ready()],()=>true).length,1);
});
test('C06 重导幂等：UID/BV/探店和高德门店去重；撤批不残留',()=>{
  const a={...batch,records:[ready()]};const b=clone(a);b.batch_id='second';b.records[0].visit.id='visit-2';
  const one=buildCatalog([a],()=>true),twice=buildCatalog([a,a],()=>true),two=buildCatalog([a,b],()=>true);
  assert.deepEqual(twice,one);assert.equal(two.creators.length,1);assert.equal(two.videos.length,1);assert.equal(two.shops.length,1);assert.equal(two.visits.length,2);assert.equal(buildCatalog([],()=>true).shops.length,0);
});
test('C07 本批不包含视频/音轨，公开图片必须走自有路径',()=>{
  const fs=require('node:fs');for(const f of fs.readdirSync('content',{recursive:true}))assert.ok(!/\.(mp4|m4s|flv|mp3|aac|ts|m3u8|webm)$/i.test(f));
  const x=ready();x.visit.screenshots[0].path='https://external.example/a.jpg';assert.ok(assess(x).length);
});
test('C06 新的已核准记录在同一份网页及 MCP 搜索服务中入榜；待核项不入榜',async()=>{
  const {createNearbyService}=require('./nearby.cjs');
  const r=ready();r.visit.gcj02={lng:116.411571,lat:39.908069};
  const contentCatalog=buildCatalog([{...batch,records:[r]}],()=>true);
  const result=await createNearbyService({dataset:'verified',contentCatalog}).query({location:'北京王府井地铁站'});
  assert.equal(result.results[0].id,'amap:B000TEST');assert.equal(result.results[0].video,r.video.url);assert.equal(result.results[0].meters,0);
  const fixed=await createNearbyService({contentCatalog}).query({location:'北京王府井地铁站'});assert.ok(!fixed.results.some(s=>s.id==='amap:B000TEST'));
});
