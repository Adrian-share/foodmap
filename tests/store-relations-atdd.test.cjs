// Every scenario starts from the SAME genuine immutable 16, then uses offline C2.
const {test}=require('node:test'),assert=require('node:assert/strict');const {sixteen}=require('./fixtures/sixteen-publication.cjs'),{visit,proof}=require('./fixtures/store-identity.cjs');
const {catalogData,createNearbyService}=require('../nearby.cjs'),{homeCatalog}=require('../content/home.cjs');
const {cases,soho}=require('./fixtures/relation-cases.cjs');
for(const c of cases)test('ATDD16 '+c.name,async()=>{
 const env=await sixteen(),before=JSON.stringify(env.original);assert.equal(catalogData('verified',env.original.catalog).shops.filter(s=>s.city==='北京'&&s.verification==='verified').length,16);const f=await visit({uid:'613814196',...c.options}),originalC2=JSON.stringify(f.result.documents),plan=await env.prepare([f],c.aliases,c.proofs);await plan.stage();assert.equal((await env.pub.current()).data_version,env.curveVersion);
 const state=await env.reader.snapshot(plan.version),joined=catalogData('verified',state.catalog),id=c.id||'amap:OFFLINE_TAIFENG';assert.equal(joined.shops.length,c.count);assert.equal(homeCatalog(state).shops.length,c.count);assert.equal(state.records.length,17);assert.equal(new Set(state.records.map(r=>r.video.bvid)).size,17);assert.equal(joined.shops.filter(s=>s.id===id).length,1);
 const nearby=createNearbyService({mode:'fixture',dataset:'verified',contentCatalog:state.catalog}),result=await nearby.query({location:'王府井',limit:50,creator:f.result.records[0].creator.uid});const shop=result.results.find(s=>s.id===id);assert(shop);assert(shop.visits.some(v=>v.bvid===f.result.records[0].video.bvid));
 assert.equal(JSON.stringify(f.result.documents),originalC2);assert.equal(JSON.stringify(await env.reader.snapshot(env.curveVersion)),before);
});
for(const options of [
 {},
 {storeName:'泰丰楼快餐二店',branchName:'前门店'},
 {branchName:'前门街店',address:'前门西大街'},
 {storeName:'潇湘阁',branchName:'三里屯商场店',address:'三里屯SOHO1号商场B1',district:'朝阳区',gcj02:{lng:soho.lng,lat:soho.lat}},
 {storeName:'潇湘阁',branchName:'三里屯118店',address:'三里屯SOHO1号商场118铺',district:'朝阳区',gcj02:{lng:soho.lng,lat:soho.lat}},
 {branchName:'前门二店',address:'前门西大街50号',poiName:'泰丰楼文化中心(前门二店)',poiType:'140000',officialDescription:true}
])test('ATDD16 unknown/rejected '+JSON.stringify(options),async()=>{const env=await sixteen(),f=await visit(options),plan=await env.prepare([f]),before=JSON.stringify(await env.pub.current());await assert.rejects(()=>plan.stage(),/store_identity_pending/);assert.equal(JSON.stringify(await env.pub.current()),before);assert.equal((await env.reader.snapshot()).records.length,16);});
test('ATDD16 version rollback and old publisher preserve original bytes/identity/images',async()=>{
 const env=await sixteen(),old=JSON.stringify(env.original),f=await visit({uid:'613814196'}),plan=await env.prepare([f],{OFFLINE_TAIFENG:'beijing-1'},[proof()]);await plan.stage();await env.commit(plan.version);const one=JSON.stringify(await env.reader.snapshot());await env.commit(env.curveVersion,true);assert.equal(JSON.stringify(await env.reader.snapshot()),old);await env.commit(plan.version,true);assert.equal(JSON.stringify(await env.reader.snapshot()),one);
 const legacy={...plan.manifest,parent_version:plan.version};delete legacy.store_aliases;delete legacy.store_alias_evidence;const {canonical}=require('../content/protocol.cjs'),{sha}=require('./fixtures/publication.cjs'),bytes=Buffer.from(JSON.stringify(canonical(legacy))),version='v1-'+sha(bytes);await env.bucket.put('private/manifests/'+sha(bytes)+'.json',bytes);await env.pub.operation({schema_version:1,request_id:require('node:crypto').randomUUID(),operation:'release.stage',manifest_sha256:sha(bytes)});const inherited=await env.reader.snapshot(version);assert.equal(catalogData('verified',inherited.catalog).shops.length,16);assert.deepEqual(inherited.store_aliases,{OFFLINE_TAIFENG:'beijing-1'});
});
