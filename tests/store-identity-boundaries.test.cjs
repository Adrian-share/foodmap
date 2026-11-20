// fixture=true, memory bucket and synthetic C2 only. No production writes/model.
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {visit,proof,manifest}=require('./fixtures/store-identity.cjs'),{Bucket,sha}=require('./fixtures/publication.cjs');
const {identityPending,sameVenue}=require('../content/store-identity.cjs'),{createPublicationService}=require('../content/publication.cjs'),{createReadModel}=require('../content/read-model.cjs');
const {catalogData}=require('../nearby.cjs');
const old=require('../data/catalog.json').shops.find(s=>s.id==='beijing-1');
const distinct={poi:'OFFLINE_TONGZHOU',branchName:'通州店',address:'滨河路52号',district:'通州区',gcj02:{lng:116.65,lat:39.91},officialDescription:true};
async function staged(f,aliases={},evidence=[]){
 const bucket=new Bucket();await bucket.put('private/watchlist-v1.json',JSON.stringify({registry_revision:1,accepted_sources:[{uid:'544336675'}]}));
 const m=manifest(f.result.records,aliases,evidence),record=f.result.records[0],image=record.visit.screenshots[0];m.images=[{path:image.path,sha256:sha(f.raw),mime_type:'image/png',bytes:f.raw.length,width:64,height:64}];
 const raw=Buffer.from(JSON.stringify(m)),hash=sha(raw);await bucket.put('private/manifests/'+hash+'.json',raw);for(const d of f.result.documents)await bucket.put('private/evidence/'+d.sha256+'.json',d.bytes);await bucket.put('private/blobs/image/'+sha(f.raw),f.raw);
 const pub=createPublicationService({bucket,probe:async()=>true});const stage=await pub.operation({schema_version:1,operation:'release.stage',request_id:crypto.randomUUID(),manifest_sha256:hash});return {stage,bucket,pub};
}
test('RED C2 v2 distinct street/branch/coordinates stages before unrelated legacy POI mapping exists',async()=>{
 const f=await visit(distinct);assert.equal(f.result.records[0].review.rules_version,'v2');const raw=JSON.stringify(f.result.documents);
 const {stage,bucket,pub}=await staged(f);assert.equal(stage.status,'complete');assert.deepEqual(identityPending(f.result.records[0],{}),[]);assert.equal(await pub.current(),null);const snapshot=await createReadModel({bucket}).snapshot(stage.data_version),shops=catalogData('verified',snapshot.catalog).shops;
 assert.equal(shops.length,16);assert(shops.some(s=>s.id==='beijing-1'));assert(shops.some(s=>s.id==='amap:OFFLINE_TONGZHOU'));assert.equal(snapshot.records.find(r=>r.video.bvid==='BV1abcde2345').visit.store_id,'amap:OFFLINE_TONGZHOU');assert.equal(JSON.stringify(f.result.documents),raw);
});
test('RED cross-C2 stage independently rejects prefix-only identity proof even at the same house and coordinate',async()=>{
 const p=proof('OFFLINE_PREFIX',{name:'泰丰楼快餐二店'}),rawPoi=JSON.parse(Buffer.from(p.response_base64,'base64')).pois[0];
 const name='泰丰楼快餐二店',f=await visit({poi:'OFFLINE_PREFIX',storeName:name,officialDescription:true});assert.equal(f.result.records[0].review.rules_version,'v2');
 await assert.rejects(()=>staged(f,{OFFLINE_PREFIX:'beijing-1'},[proof('OFFLINE_PREFIX',{name:name+'(前门店)'})]),/store_identity_not_unique/);assert.equal(sameVenue(old,rawPoi),false);
 await assert.rejects(()=>staged(f),/store_identity_pending/);
});
test('missing street or unresolved branch stays pending despite an otherwise valid original C2 result',async()=>{
 for(const override of [{address:'通州购物中心2号楼',officialDescription:false},{branchName:'泰丰楼',officialDescription:true},{branchName:'前门店',address:'滨河路52号',gcj02:{lng:old.lng,lat:old.lat}}]){
  const f=await visit({...distinct,...override});assert.deepEqual(identityPending(f.result.records[0],{}),['store_identity_unresolved']);await assert.rejects(()=>staged(f),/store_identity_pending/);
 }
});
test('culture/hotel/mall mother POI cannot stage as a distinct restaurant or supply a legacy identity',async()=>{
 for(const [type,name] of [['140000','泰丰楼文化中心'],['100000','泰丰楼酒店'],['060000','泰丰楼商场']]){
  const f=await visit({...distinct,poiType:type,poiName:name+'(通州店)'});assert.equal(f.result.records[0].review.rules_version,'v2');await assert.rejects(()=>staged(f),/store_identity_pending/);
  const p=proof('OFFLINE_PARENT',{name:'泰丰楼(前门店)',typecode:type});await assert.rejects(()=>require('../content/store-identity.cjs').validateStoreIdentity({store_aliases:{OFFLINE_PARENT:'beijing-1'},store_alias_evidence:[p]}));
 }
});
test('identity independence does not bypass C2 exact record/doc checks',async()=>{
 const f=await visit(distinct);f.result.records[0].visit.branch_name='未在核准文档内的分店';await assert.rejects(()=>staged(f),/verification_failed/);
});
