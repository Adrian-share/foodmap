const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const cases = {
  '北京王府井地铁站': {city:'北京', district:'东城区', point:[116.411571,39.908069],
    names:['富春居（北京璞瑄酒店店）','泰丰楼','北京宜宾招待所·餐厅'], km:[1.72,1.92,2.82],
    videos:['BV1144y1G7Fo','BV1CB4y147BG','BV1wT1WYxEjC']},
  '上海豫园地铁站': {city:'上海', district:'黄浦区', point:[121.487426,31.228005],
    names:['上海老饭店（豫园店）','绿波廊酒楼（豫园总店）','和平饭店龙凤厅'], km:[0.31,0.46,1.25],
    videos:['BV1Yq4y1m7Uq','BV1bqKnzgEwU','BV1gb4y1h7gj']}
};
for (const [location, expected] of Object.entries(cases)) test(`${location}：固定 ATDD 起点、三家、独立距离复算与原视频`, async () => {
  const {createNearbyService} = require('./nearby.cjs');
  const result = await createNearbyService().query({location});
  assert.equal(result.status,'ok');
  assert.equal(result.origin.city,expected.city);
  assert.equal(result.origin.district,expected.district);
  assert.deepEqual([result.origin.lng,result.origin.lat],expected.point);
  assert.deepEqual(result.results.map(s=>s.name),expected.names);
  result.results.forEach((s,i)=>{
    assert.ok(Math.abs(s.meters/1000-expected.km[i])<=0.05);
    const rad=n=>n*Math.PI/180, o=result.origin;
    const independent=6371000*Math.acos(Math.min(1,Math.sin(rad(o.lat))*Math.sin(rad(s.lat))+Math.cos(rad(o.lat))*Math.cos(rad(s.lat))*Math.cos(rad(o.lng-s.lng))));
    assert.ok(Math.abs(s.meters-independent)<0.01);
    assert.equal(s.video,`https://www.bilibili.com/video/${expected.videos[i]}/`);
    assert.ok(s.visits.length>0 && s.visits.every(v=>v.video && v.creator));
  });
});
for (const location of ['我附近有什么？','','我在这里']) test(`无位置 ${JSON.stringify(location)}：先追问，零解析`,async()=>{
  const events=[];
  const {createNearbyService}=require('./nearby.cjs');
  const s=createNearbyService({audit:e=>events.push(e)});
  const r=await s.query({location});
  assert.equal(r.status,'needs_location');assert.deepEqual(r.results,[]);
  assert.equal(events.filter(e=>e.event==='location_resolve').length,0);
  assert.equal((await s.query({location:'上海豫园地铁站'})).origin.city,'上海');
});
test('城市冲突、未知位置不沿用上一地点',async()=>{
  const {createNearbyService}=require('./nearby.cjs');const s=createNearbyService();
  await s.query({location:'上海豫园地铁站'});
  for(const input of [{location:'北京豫园地铁站'},{location:'北京王府井',city:'上海'},{location:'不存在的酒店xyz'}]) {
    const r=await s.query(input);assert.notEqual(r.status,'ok');assert.deepEqual(r.results,[]);
  }
});
test('待核对上海门店退出正式收录排名，固定样本明确标记',async()=>{
  const {createNearbyService}=require('./nearby.cjs');
  const fixed=await createNearbyService().query({location:'上海豫园地铁站'});
  assert.equal(fixed.dataset,'fixture');assert.match(fixed.scope,/固定|样本/);
  const verified=await createNearbyService({dataset:'verified'}).query({location:'上海豫园地铁站'});
  assert.ok(verified.results.every(s=>s.verification==='verified'));
  assert.ok(!verified.results.some(s=>s.name.includes('157')));
});
test('实时地名解析限制上海、排除外地和非车站，歧义先选再查询',async()=>{
  const {createNearbyService}=require('./nearby.cjs');let requested;
  const request=async url=>{requested=new URL(url);return Response.json({status:'1',pois:[
    {id:'a',name:'豫园(地铁站)',location:'121.487426,31.228005',typecode:'150500',cityname:'上海市',adname:'黄浦区',address:'A口'},
    {id:'b',name:'豫园(地铁站)',location:'121.4875,31.2281',typecode:'150500',cityname:'上海市',adname:'黄浦区',address:'B口'},
    {id:'mall',name:'豫园商场',location:'121.488,31.229',typecode:'060100'},
    {id:'wrong',name:'豫园(地铁站)',location:'116.41,39.90',typecode:'150500'}]});};
  const s=createNearbyService({mode:'live',serviceKey:'private',request});
  const r=await s.query({location:'上海豫园地铁站'});
  assert.equal(requested.searchParams.get('region'),'310000');
  assert.equal(r.status,'ambiguous');assert.deepEqual(r.results,[]);
  assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].district,'黄浦区');
  const selected=await s.query({location:'上海豫园地铁站',origin_id:r.candidates[1].id});
  assert.equal(selected.origin.id,'b');
  assert.equal((await s.query({location:'上海豫园地铁站',origin_id:'forged'})).status,'location_not_found');
});
test('网页 HTTP 与真实 MCP 协议共用同一版本结果；并发双城不串数据',async t=>{
  const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');
  const {createServer}=require('./amap-server.cjs');
  const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');
  const base=`http://127.0.0.1:${s.address().port}`;
  const c=new Client({name:'dual-city-atdd',version:'1'});
  t.after(async()=>{await c.close();await new Promise(r=>s.close(r));});
  await c.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp')));
  await Promise.all(Object.keys(cases).map(async location=>{
    const web=await (await fetch(base+'/api/nearby?'+new URLSearchParams({location}))).json();
    const mcp=(await c.callTool({name:'find_nearby_food',arguments:{location}})).structuredContent;
    assert.deepEqual(mcp,web);assert.equal(web.status,'ok');assert.ok(web.data_version);
  }));
});
module.exports={cases};
