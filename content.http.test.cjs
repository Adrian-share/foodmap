const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const {createContentHandler}=require('./content/http.cjs');
const handle=createContentHandler({readAsset:f=>readFile(f)});
test('公开内容与审核清单分离，未准用参考图永不下发',async()=>{
  const published=await(await handle(new Request('https://test/api/content'))).json();assert.equal(published.records.length,1);
  const review=await(await handle(new Request('https://test/api/content?review=1'))).json();assert.equal(review.records.length,9);
  assert.equal(review.records.filter(r=>r.published).length,1);assert.ok(review.records.filter(r=>!r.published).every(r=>r.visit.screenshots.length===0));assert.ok(!JSON.stringify(review).includes('reference-images'));
  for(const f of ['/content/reference-images/BV1k1KN6BEvw-p1-0.jpg','/content/sources/BV1k1KN6BEvw.json','/content/public-assets.json'])assert.equal((await handle(new Request('https://test'+f))).status,404);
});
test('Node 与 Worker 共用内容路由，页面、脚本、CSS 可读取且只读',async()=>{
  for(const f of ['/content/','/content/app.js','/content/style.css'])assert.equal((await handle(new Request('https://test'+f))).status,200);
  assert.equal((await handle(new Request('https://test/api/content',{method:'POST'}))).status,405);
});
test('内容入口保持本站，部署只允许官方播放器而不代理视频',async()=>{
  for(const f of ['prototype.js','beijing-food-map/prototype.js']){
    const js=await readFile(f,'utf8');assert.ok(!js.includes("link('探店记录', shop.source)"));assert.ok(js.includes('/content/?bvid='));
  }
  const js=await readFile('content/app.js','utf8');assert.ok(js.includes("allow-scripts allow-same-origin allow-presentation"));assert.ok(!js.includes('allow-top-navigation'));
  for(const f of ['/content/video.mp4','/content/proxy?url=https://example.com/video.mp4'])assert.equal((await handle(new Request('https://test'+f))).status,404);
});
