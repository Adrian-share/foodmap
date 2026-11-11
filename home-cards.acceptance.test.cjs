const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHandler}=require('./beijing-food-map/amap-handler.cjs');
test('A02 首页实际目录包含原十家之外的亚运村分店，能从普通起点距离排序找到',async()=>{
  const response=await createHandler()(new Request('https://test/api/home/catalog'));
  assert.equal(response.status,200);
  const data=await response.json();const original=require('./beijing-food-map/samples.js').restaurants;
  const shop=data.shops.find(s=>s.id==='amap:B0FFGCY5QP');assert.ok(shop);assert.ok(!original.some(s=>s.id===shop.id||s.name.includes('蓉亭')));
  const ranked=require('./beijing-food-map/samples.js').closest({lng:116.407926,lat:40.002119},data.shops);
  assert.equal(ranked[0].id,shop.id);assert.ok(ranked[0].meters>0);
  assert.equal(shop.visits[0].bvid,'BV1AdqYYNEDM');assert.equal(shop.image.timestamp_ms,30000);assert.equal(shop.creator,'厨者王波');assert.match(shop.note,/肉丝.*嫩/);
});
test('A05 新店在共享 HTTP 与 MCP 结果中保持分店、原视频和截帧一致',async t=>{
  const {createServer}=require('./amap-server.cjs');
  const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');
  const server=createServer({mode:'live',dataset:'verified',serviceKey:'test-only',request:async()=>Response.json({status:'1',pois:[{id:'station-anlilu',name:'安立路(地铁站)',adname:'朝阳区',location:'116.407845,40.002619',typecode:'150500'}]})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;const client=new Client({name:'home-card-acceptance',version:'1'});
  t.after(async()=>{await client.close();await new Promise(r=>server.close(r));});await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
  const http=await(await fetch(base+'/api/nearby?'+new URLSearchParams({location:'北京安立路地铁站'}))).json();
  const mcp=(await client.callTool({name:'find_nearby_food',arguments:{location:'北京安立路地铁站'}})).structuredContent;
  assert.deepEqual(mcp,http);assert.equal(http.results[0].id,'amap:B0FFGCY5QP');assert.equal(http.results[0].image.timestamp_ms,30000);assert.equal(http.results[0].video,'https://www.bilibili.com/video/BV1AdqYYNEDM/');
});
test('A05 分店按 POI 去重，保留多个探店关系，重导同批不增点位',()=>{
  const {buildCatalog}=require('./content/catalog.cjs');const batch=require('./content/batches/beijing-pilot-001.json');
  const a=buildCatalog([batch]),b=buildCatalog([batch,batch]);assert.deepEqual(a,b);assert.equal(a.shops.filter(s=>s.amap_poi_id==='B0FFGCY5QP').length,1);
  const extra=structuredClone(batch);extra.batch_id='second';const r=extra.records.find(r=>r.video.bvid==='BV1AdqYYNEDM');r.visit.id='second-visit';
  const two=buildCatalog([batch,extra]);assert.equal(two.shops.filter(s=>s.amap_poi_id==='B0FFGCY5QP').length,1);assert.equal(two.visits.filter(v=>v.shop_id==='amap:B0FFGCY5QP').length,2);
});
