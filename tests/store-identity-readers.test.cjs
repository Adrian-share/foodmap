// fixture=true. Real public 16 + offline POIs; no model, live queue or publication.
const {test}=require('node:test'),assert=require('node:assert/strict');const {cohort}=require('./fixtures/public-sixteen-fixture.cjs');
const {createNearbyService,catalogData}=require('../nearby.cjs'),{homeCatalog}=require('../content/home.cjs'),{createContentHandler}=require('../content/http.cjs');
test('original real 16 remain 16 after two same-branch BV visits; records/catalog/ledger/detail/pagination share identity',async()=>{
 const {state,original,a,b,version}=await cohort();const joined=catalogData('verified',state.catalog);assert.equal(joined.shops.length,16);assert.equal(state.records.length,original.records.length+2);assert.equal(new Set(state.records.map(r=>r.video.bvid)).size,18);
 const own=joined.visits.filter(v=>v.shop_id==='beijing-1');assert.equal(own.length,3);for(const v of own)assert.equal(v.record.visit.store_id,'beijing-1');assert.equal(homeCatalog(state).shops.length,16);
 const nearby=createNearbyService({mode:'fixture',dataset:'verified',contentCatalog:state.catalog}),page=await nearby.query({location:'王府井',limit:6});const next=await nearby.query({location:'王府井',limit:6,offset:6,data_version:version});assert.equal(page.total,16);assert.equal(new Set([...page.results,...next.results].map(s=>s.id)).size,12);assert.equal(page.data_version,version);
 const handler=createContentHandler({state,readAsset:async()=>''});
 for(const r of [...a.result.records,...b.result.records]){
  const response=await handler(new Request('https://offline.test/api/content?visit_id='+encodeURIComponent(r.video.bvid+':1:'+r.visit.id)));const value=await response.json();assert.equal(value.data_version,version);assert.equal(value.records[0].visit.store_id,'beijing-1');assert(value.records[0].detail_url.includes(encodeURIComponent(version)));
  const video=state.ledger.videos.find(v=>v.bvid===r.video.bvid),visit=video.visits[0];assert.equal(visit.store_id,'beijing-1');assert.equal(new URL(visit.map_url,'https://offline.test').searchParams.get('data_version'),version);
 }
 const oldId=original.records.find(r=>r.visit.store_id==='beijing-1').visit_id;assert.equal((await(await handler(new Request('https://offline.test/api/content?visit_id='+oldId))).json()).records[0].visit_id,oldId);
});
test('actual local MCP discovery/call reads the same immutable full snapshot and each creator own card',async t=>{
 const {state,a,b,version}=await cohort();const {once}=require('node:events');const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');const {sanitize}=require('../content/read-model.cjs');
 const server=require('../mcp-server.cjs').createFoodServer({mode:'fixture',dataset:'verified',contentState:state,contentOrigin:'https://foodmap.shareworld.fun',snapshotRequest:async url=>Response.json(new URL(url).pathname.endsWith('/current')?{data_version:version}:sanitize(state))});
 server.listen(0,'127.0.0.1');await once(server,'listening');const client=new Client({name:'offline-same-store',version:'1'});t.after(async()=>{await client.close();await new Promise(r=>server.close(r));});await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp')));await client.listTools();
 for(const fixture of [a,b]){const r=fixture.result.records[0],response=await client.callTool({name:'find_nearby_food',arguments:{location:'王府井',creator:r.creator.uid}});assert.notEqual(response.isError,true);const data=response.structuredContent;assert.equal(data.data_version,version);const shop=data.results.find(s=>s.id==='beijing-1');assert(shop);assert.equal(shop.card.video.bvid,r.video.bvid);assert.equal(shop.card.creator.uid,r.creator.uid);assert.equal(shop.image.sha256,r.visit.screenshots[0].sha256);assert.equal(shop.card.description.text,r.visit.opinions[0].text);assert(shop.detail_url.includes(encodeURIComponent(version)));}
});
