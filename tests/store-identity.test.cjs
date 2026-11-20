// fixture=true throughout: fake POIs/evidence, isolated memory only; production writes=0.
const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {input,sha,png,Bucket}=require('./fixtures/publication.cjs');
const {verifyExtraction}=require('../content/verification.cjs');
const {createContentState}=require('../content/state.cjs');
const frozen=require('../content/compiled.json'),assets=require('../content/public-assets.json');
const {catalogData,createNearbyService}=require('../nearby.cjs');
const {createReadModel}=require('../content/read-model.cjs');
const base=require('../data/catalog.json'),canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const {visit,proof,manifest,stored}=require('./fixtures/store-identity.cjs');
test('RED same accepted branch has one legacy shop and two visit/BV records, projected IDs agree without altering raw C2',async()=>{
 const f=await visit(),original=JSON.stringify(f.result.documents),record=f.result.records[0];const aliases={OFFLINE_TAIFENG:'beijing-1'};
 const state=createContentState({...frozen,version:'offline-version',config:{...frozen.config,store_aliases:aliases},store_aliases:aliases,identity_projection:true,batches:[...frozen.batches,{batch_id:'offline',version:'one',records:[record]}]},f.images);
 const joined=catalogData('verified',state.catalog),shop=joined.shops.filter(s=>s.id==='beijing-1');assert.equal(shop.length,1);assert(!joined.shops.some(s=>s.id==='amap:OFFLINE_TAIFENG'));
 const visits=joined.visits.filter(v=>v.shop_id==='beijing-1');assert.equal(visits.length,2);assert.equal(new Set(visits.map(v=>v.bvid)).size,2);
 const projected=state.records.find(r=>r.video.bvid===record.video.bvid);assert.equal(projected.visit.store_id,'beijing-1');assert.equal(visits.find(v=>v.bvid===record.video.bvid).record.visit.store_id,'beijing-1');assert.equal(record.visit.store_id,'amap:OFFLINE_TAIFENG');assert.equal(JSON.stringify(f.result.documents),original);
});
test('RED identity is part of immutable version; legacy/new/old-writer snapshots coexist and do not read mutable global aliases',async()=>{
 const bucket=new Bucket(),reader=createReadModel({bucket});const a=manifest();const v0=await stored(bucket,a);const old=await reader.snapshot(v0);
 const b=manifest([],{OFFLINE_TAIFENG:'beijing-1'},[proof()]);b.parent_version=v0;const v1=await stored(bucket,b);const one=await reader.snapshot(v1);assert.deepEqual(one.store_aliases,b.store_aliases);assert.deepEqual(one.catalog.store_aliases,b.store_aliases);
 const c=manifest();c.parent_version=v1;const v2=await stored(bucket,c);assert.deepEqual((await reader.snapshot(v2)).store_aliases,b.store_aliases);
 const config=require('../content/config.json'),prior=config.store_aliases,frozenPrior=frozen.config.store_aliases;try{config.store_aliases={OFFLINE_TAIFENG:'beijing-2'};frozen.config.store_aliases={OFFLINE_TAIFENG:'beijing-2',B0FFGCY5QP:'beijing-1'};assert.deepEqual(await reader.snapshot(v0),old);assert.deepEqual((await reader.snapshot(v1)).store_aliases,b.store_aliases);}finally{config.store_aliases=prior;frozen.config.store_aliases=frozenPrior;}
 assert.equal((await reader.snapshot(v1)).data_version,v1);assert.notEqual(v1,v2);
});
test('RED unresolved legacy relationship and mall/hotel parent cannot masquerade as a net new store',async()=>{
 const f=await visit();const {validateStoreIdentity,identityPending}=require('../content/store-identity.cjs');
 assert.deepEqual(identityPending(f.result.records[0],{}),['store_identity_unresolved']);
 const p=proof();let raw=JSON.parse(Buffer.from(p.response_base64,'base64'));raw.pois[0].typecode='100000';const bytes=Buffer.from(JSON.stringify(raw));p.response_base64=bytes.toString('base64');p.response_sha256=sha(bytes);
 await assert.rejects(()=>validateStoreIdentity({store_aliases:{OFFLINE_TAIFENG:'beijing-1'},store_alias_evidence:[p]}),/identity/);
});
test('same brand different confirmed POIs remain two branches; per-creator card uses its own video and image',async()=>{
 const f=await visit(),g=await visit({poi:'OFFLINE_OTHER',bvid:'BV1abcde2346',uid:'3546728118618546',description:'第二条视频自己的原文'});const aliases={OFFLINE_TAIFENG:'beijing-1'};
 const images={...f.images,...g.images};const config={...frozen.config,store_aliases:aliases};const state=createContentState({...frozen,identity_projection:true,store_aliases:aliases,config,batches:[...frozen.batches,{batch_id:'offline',version:'one',records:[...f.result.records,...g.result.records]}]},images);
 const joined=catalogData('verified',state.catalog);assert(joined.shops.some(s=>s.id==='beijing-1'));assert(joined.shops.some(s=>s.id==='amap:OFFLINE_OTHER'));
 const {decorate}=require('../mcp-server.cjs'),nearby=createNearbyService({mode:'fixture',dataset:'verified',contentCatalog:state.catalog});
 for(const r of [...f.result.records,...g.result.records]){const data=decorate(await nearby.query({location:'王府井',creator:r.creator.uid,limit:50}),'https://offline.test',images);const item=data.results.find(s=>s.visits.some(v=>v.bvid===r.video.bvid));assert(item);assert.equal(item.card.video.bvid,r.video.bvid);assert.equal(item.card.creator.uid,r.creator.uid);assert.equal(item.image.source_video,r.video.url);assert.equal(item.card.description.text,r.visit.opinions[0].text);assert.equal(item.image.sha256,r.visit.screenshots[0].sha256);}
});
async function prepare(bucket,m,fixture){
 const raw=Buffer.from(JSON.stringify(m)),hash=sha(raw);await bucket.put('private/manifests/'+hash+'.json',raw);
 if(fixture){for(const d of fixture.result.documents)await bucket.put('private/evidence/'+d.sha256+'.json',d.bytes);for(const i of m.images)await bucket.put('private/blobs/image/'+i.sha256,fixture.raw);}
 return hash;
}
function withImages(m,f){m.images=[{path:f.result.records[0].visit.screenshots[0].path,sha256:sha(f.raw),mime_type:'image/png',bytes:f.raw.length,width:64,height:64}];return m;}
const operation=(name,fields={})=>({schema_version:1,operation:name,request_id:crypto.randomUUID(),...fields});
test('RED stage checks identity after raw C2 and never publishes unresolved overlap; explicit mapping admits same visit',async()=>{
 const {createPublicationService}=require('../content/publication.cjs');const bucket=new Bucket();await bucket.put('private/watchlist-v1.json',JSON.stringify({registry_revision:1,accepted_sources:[{uid:'544336675'}]}));const service=createPublicationService({bucket,probe:async()=>true});const f=await visit();
 let m=withImages(manifest(f.result.records),f),hash=await prepare(bucket,m,f);await assert.rejects(()=>service.operation(operation('release.stage',{manifest_sha256:hash})),/store_identity_pending/);
 assert.equal(await service.current(),null);assert.equal(await bucket.get('public/releases/v1-'+hash+'.json'),null);
 m=withImages(manifest(f.result.records,{OFFLINE_TAIFENG:'beijing-1'},[proof()]),f);hash=await prepare(bucket,m,f);const staged=await service.operation(operation('release.stage',{manifest_sha256:hash}));assert.equal(staged.status,'complete');
 const receipt=await service.operation(operation('release.commit',{data_version:staged.data_version,expected_parent_version:null,expected_pointer_etag:null}));assert.equal(receipt.status,'committed');
 const s=await createReadModel({bucket}).snapshot(staged.data_version);assert.equal(catalogData('verified',s.catalog).shops.length,15);assert.equal(s.records.find(r=>r.video.bvid==='BV1abcde2345').visit.store_id,'beijing-1');
});
test('RED bad response hash, ambiguous same address, cross-target and contradictory legacy bindings fail before pointer change',async()=>{
 const {validateStoreIdentity}=require('../content/store-identity.cjs');
 for(const mutate of [p=>p.response_sha256='0'.repeat(64),p=>p.baseline_sha256='0'.repeat(64),p=>p.source_url+='&key=forbidden',p=>{const x=JSON.parse(Buffer.from(p.response_base64,'base64'));x.pois.push({...x.pois[0],id:'OFFLINE_SECOND'});const raw=Buffer.from(JSON.stringify(x));p.response_base64=raw.toString('base64');p.response_sha256=sha(raw);}]){
  const p=proof();mutate(p);await assert.rejects(()=>validateStoreIdentity({store_aliases:{OFFLINE_TAIFENG:'beijing-1'},store_alias_evidence:[p]}));
 }
 await assert.rejects(()=>validateStoreIdentity({store_aliases:{OFFLINE_TAIFENG:'beijing-2'},store_alias_evidence:[proof()]}));
 await assert.rejects(()=>validateStoreIdentity({store_aliases:{OFFLINE_TAIFENG:'beijing-1',OFFLINE_SECOND:'beijing-1'},store_alias_evidence:[proof(),proof('OFFLINE_SECOND')]}));
});
test('isolated CAS rollback restores immutable identity, raw JSON/images and legacy URLs; old writer inherits parent',async()=>{
 const {createPublicationService}=require('../content/publication.cjs'),bucket=new Bucket(),f=await visit();await bucket.put('private/watchlist-v1.json',JSON.stringify({registry_revision:1,accepted_sources:[{uid:'544336675'}]}));const pub=createPublicationService({bucket,probe:async()=>true}),reader=createReadModel({bucket});
 async function stage(m,fixture){const hash=await prepare(bucket,m,fixture);return (await pub.operation(operation('release.stage',{manifest_sha256:hash}))).data_version;}
 async function switchTo(version,rollback=false){const pointer=await pub.current();return pub.operation(operation(rollback?'release.rollback':'release.commit',{...(rollback?{reason:'isolated identity rollback'}:{}),data_version:version,expected_parent_version:pointer?.data_version||null,expected_pointer_etag:pointer?.pointer_etag||null}));}
 const v0=await stage(manifest());await switchTo(v0);const old=JSON.stringify(await reader.snapshot(v0));
 const m=withImages(manifest(f.result.records,{OFFLINE_TAIFENG:'beijing-1'},[proof()]),f);m.parent_version=v0;const v1=await stage(m,f);await switchTo(v1);const one=JSON.stringify(await reader.snapshot(v1));const raw=JSON.stringify(f.result.documents);const bytes=await(await bucket.get('public/releases/'+v1+'.json')).text();
 // A pre-extension publisher can omit both fields, but cannot erase inherited aliases.
 const legacy={...m,parent_version:v1};delete legacy.store_aliases;delete legacy.store_alias_evidence;const v2=await stage(legacy,f);await switchTo(v2);assert.deepEqual((await reader.snapshot(v2)).store_aliases,m.store_aliases);
 const rollback=operation('release.rollback',{reason:'isolated identity rollback',data_version:v0,expected_parent_version:v2,expected_pointer_etag:(await pub.current()).pointer_etag});await pub.operation(rollback);const generation=(await pub.current()).generation;await pub.operation(rollback);assert.equal((await pub.current()).generation,generation);assert.equal(JSON.stringify(await reader.snapshot()),old);
 await switchTo(v1,true);assert.equal(JSON.stringify(await reader.snapshot()),one);assert.equal((await(await bucket.get('public/releases/'+v1+'.json')).text()),bytes);assert.equal(JSON.stringify(f.result.documents),raw);
 const image=await pub.image(new Request('https://offline.test/'+m.images[0].path));assert.equal(image.status,200);assert.equal(sha(Buffer.from(await image.arrayBuffer())),m.images[0].sha256);
 const revoked={...m,parent_version:v1,store_aliases:{},store_alias_evidence:[]};await assert.rejects(()=>stage(revoked,f),/store_identity_pending/);assert.equal((await pub.current()).data_version,v1);
});
test('legacy parent corruption fails closed; hotel parent without type cannot bind a restaurant',async()=>{
 const bucket=new Bucket(),m=manifest();const v0=await stored(bucket,m),child=manifest();child.parent_version=v0;const v1=await stored(bucket,child);await bucket.put('public/releases/'+v0+'.json',JSON.stringify({...m,rules_version:'tampered'}));await assert.rejects(()=>createReadModel({bucket}).snapshot(v1),/hash_mismatch/);
 const {validateStoreIdentity}=require('../content/store-identity.cjs'),p=proof();const raw=JSON.parse(Buffer.from(p.response_base64,'base64'));delete raw.pois[0].typecode;raw.pois[0].name='泰丰楼酒店';const b=Buffer.from(JSON.stringify(raw));p.response_base64=b.toString('base64');p.response_sha256=sha(b);await assert.rejects(()=>validateStoreIdentity({store_aliases:{OFFLINE_TAIFENG:'beijing-1'},store_alias_evidence:[p]}),/not_unique/);
});
