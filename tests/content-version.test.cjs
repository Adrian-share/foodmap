const {test}=require('node:test'),assert=require('node:assert/strict');
const {createReadModel,createRemoteReadModel}=require('../content/read-model.cjs');const {Bucket}=require('./fixtures/publication.cjs');
const {createNearbyService}=require('../nearby.cjs');
test('R3 baseline has one explicit version and preserves 15 Beijing shops / 92 BV',async()=>{const reader=createReadModel({bucket:new Bucket()}),s=await reader.state();assert.equal(s.data_version,s.version);const data=await createNearbyService({dataset:'verified',contentCatalog:s.catalog}).query({location:'王府井',limit:50});assert.equal(data.data_version,s.version);assert.equal(data.sample_count,15);assert.equal(s.ledger.videos.length,92);const publicState=await reader.snapshot();assert.ok(!JSON.stringify(publicState).includes('verification_id'));assert.ok(!JSON.stringify(publicState).includes('session_path'));});
test('R3 pagination rejects a missing/mismatched version instead of mixing snapshots',async()=>{const s=await createReadModel().state(),nearby=createNearbyService({dataset:'verified',contentCatalog:s.catalog});await assert.rejects(()=>nearby.query({location:'王府井',offset:3}),/pagination_version_required/);await assert.rejects(()=>nearby.query({location:'王府井',offset:3,data_version:'other'}),/version_expired/);assert.equal((await nearby.query({location:'王府井',offset:3,data_version:s.version})).results.length,3);});
test('R3 MCP reader pins the current pointer then requests only that snapshot',async()=>{const calls=[],s=await createReadModel().snapshot();const remote=createRemoteReadModel({request:async url=>{calls.push(new URL(url));return Response.json(calls.length===1?{data_version:s.version}:s);}});const result=await remote.state();assert.equal(result.version,s.version);assert.equal(calls[1].searchParams.get('data_version'),s.version);});
test('R3 actual MCP HTTP transport reads the pinned public snapshot with the same version',async t=>{
 const {once}=require('node:events');const {Client,StreamableHTTPClientTransport}=require('@modelcontextprotocol/client');
 const s=await createReadModel().snapshot();let reads=0;
 const server=require('../mcp-server.cjs').createFoodServer({dataset:'verified',mode:'fixture',contentOrigin:'https://foodmap.shareworld.fun',snapshotRequest:async url=>{reads++;return Response.json(new URL(url).pathname.endsWith('/current')?{data_version:s.version}:s);}});
 server.listen(0,'127.0.0.1');await once(server,'listening');const client=new Client({name:'stage3-offline-fixture',version:'1.0.0'});
 t.after(async()=>{await client.close();await new Promise(r=>server.close(r));});
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp')));
 const discovered=await client.listTools();assert.equal(discovered.tools[0].name,'find_nearby_food');
 for(const location of ['', '王府井', '东坝', '大钟寺'])await t.test('discovery then '+(location||'needs_location'),async()=>{
  const response=await client.callTool({name:'find_nearby_food',arguments:{location}});
  assert.notEqual(response.isError,true);const data=response.structuredContent;assert.equal(data.data_version,s.version);
  if(!location){assert.equal(data.status,'needs_location');assert.deepEqual(data.results,[]);assert.equal(data.origin,undefined);assert.ok(response.content.every(c=>c.type==='text'));}
  else{assert.equal(data.status,'ok');assert.equal(data.sample_count,15);assert.equal(data.origin.name,location+'地铁站');assert.equal(data.results.length,3);assert.ok(Array.isArray(data.creators));assert.equal(data.total,15);assert.equal(data.next_offset,3);assert.ok(data.results.every(r=>r.meters>=0&&r.address&&r.video));assert.ok(data.results.every(r=>r.image?.kind==='video_screenshot'&&/^[a-f0-9]{64}$/.test(r.image.sha256)));}
 });
 assert.equal(reads,8);
});
test('R3 public reader identifies itself and treats 403/404 as errors, not an empty catalog',async()=>{const identity=require('../content/http-identity.cjs');const denied=createRemoteReadModel({request:async(url,options)=>{assert.equal(options.headers['User-Agent'],identity['User-Agent']);assert.equal(options.headers.Accept,'application/json');assert.equal(options.redirect,'manual');return new Response('',{status:403});}});await assert.rejects(()=>denied.state(),/snapshot_unavailable/);const missing=createRemoteReadModel({request:async()=>new Response('',{status:404})});await assert.rejects(()=>missing.state(),/snapshot_unavailable/);});
