const {test}=require('node:test');
const assert=require('node:assert/strict');
const {input,sha}=require('./fixtures/publication.cjs');
const archived=require('./fixtures/qulang-archived-evidence.json');
const {verifyExtraction}=require('../content/verification.cjs');
function candidate(){
 const x=input();x.sources=structuredClone(archived.sources);
 Object.assign(x.identity,{creator_uid:'3325087',bvid:'BV1f6RKBDEdK',part:1});
 Object.assign(x.proposal,x.identity,{evidence_ids:x.sources.map(s=>s.id)});
 x.proposal.visits=[{id:'visit-1',start_seconds:0,end_seconds:426,store_name:'曲廊院',branch_name:'东四十一条店',address_hint:'东四十一条25号',poi_candidates:['B0FFIPM93S'],description:'是我喜欢的简单味道。',evidence_ids:['metadata','poi','ocr:2000'],screenshot_ids:['frame:2000']}];
 return x;
}
function change(x,id,fn){const s=x.sources.find(s=>s.id===id);fn(s.payload);s.sha256=sha(JSON.stringify(s.payload));}
test('C2 v2 archived original frame + official description + unique street approves with explicit provenance',async()=>{
 const r=await verifyExtraction(candidate());assert.equal(r.status,'approved');
 const v=r.documents[0].document.verification;assert.equal(v.rules_version,'v2');
 assert.deepEqual(v.provenance.map(p=>p.role),['official_description_street','original_frame','unique_amap_street_match']);
 assert.equal(v.provenance[0].street,'东四十一条');assert.equal(v.provenance[1].image_sha256,'77b8ba0678ee3f938bb21463ebf5f80d7a65695a389a50ffa1a9bb11a651fc78');
 assert.deepEqual(v.provenance[2].excluded_pois.map(p=>p.id),['B0K6MSBN7U','B0MAKLNKCH']);
 const visit=r.records[0].visit;assert.equal(visit.amap_poi_id,'B0FFIPM93S');
 assert.equal(visit.address_source,'amap');assert.equal(visit.coordinates_source,'amap');assert.equal(visit.opinions[0].source_kind,'official_description');
 assert(!candidate().sources[0].payload.data.desc.includes('25号'));
});
const negatives={
 'brand without street':x=>change(x,'metadata',p=>p.data.desc='曲廊院，是我喜欢的简单味道。'),
 'two same-brand branches on same street':x=>change(x,'poi',p=>p.pois.push({...p.pois[0],id:'OTHER',address:'东四十一条26号'})),
 'official description conflicts with AMap':x=>change(x,'metadata',p=>p.data.desc='曲廊院在三里屯路，是我喜欢的简单味道。'),
 'frame address conflicts with description':x=>change(x,'ocr:2000',p=>p.lines.push({text:'曲廊院 三里屯路3号',confidence:1})),
 'frame house number conflicts':x=>change(x,'ocr:2000',p=>p.lines.push({text:'曲廊院 东四十一条26号',confidence:1})),
 'wrong author':x=>change(x,'metadata',p=>p.data.owner.mid=999),
 'wrong BV':x=>change(x,'metadata',p=>p.data.bvid='BV1GC4y1B7Cj'),
 'wrong P':x=>{x.identity.part=2;x.proposal.part=2;},
 'wrong frame CID':x=>change(x,'frame:2000',p=>p.cid=1),
 'corrupt screenshot hash envelope':x=>{x.sources.find(s=>s.kind==='frame').payload.sha256='0'.repeat(64);},
 'multi-store description cannot bind street':x=>change(x,'metadata',p=>p.data.desc='曲廊院和另一家店，分别在东四十一条、三里屯路。是我喜欢的简单味道。'),
 'proposal chooses excluded Sanlitun branch':x=>{x.proposal.visits[0].poi_candidates=['B0K6MSBN7U'];},
 'fabricated description':x=>{x.proposal.visits[0].description='店主说人均25元';},
};
for(const [name,mutate] of Object.entries(negatives))test('C2 v2 fails closed: '+name,async()=>{const x=candidate();mutate(x);assert.notEqual((await verifyExtraction(x)).status,'approved');});
test('C2 v2 offline publication re-verifies proofs, retains v1 records and exposes 17 unique shops',async()=>{
 const {Bucket,png}=require('./fixtures/publication.cjs');
 const {createPublicationService}=require('../content/publication.cjs');
 const {createReadModel}=require('../content/read-model.cjs');
 const {catalogData}=require('../nearby.cjs');
 const bucket=new Bucket(),bytes=png(),hash=sha(bytes);
 await bucket.put('private/watchlist-v1.json',JSON.stringify({registry_revision:2,accepted_sources:[{uid:'3325087'},{uid:'544336675'}]}));
 const service=createPublicationService({bucket,probe:async()=>true});
 const op=(operation,fields)=>({schema_version:1,operation,request_id:crypto.randomUUID(),...fields});
 const upload=async(kind,b)=>{const h=sha(b);await service.operation(op('blob.chunk',{blob_kind:kind,blob_sha256:h,mime_type:kind==='image'?'image/png':'application/json',total_bytes:b.length,chunk_index:0,chunk_count:1,chunk_sha256:h,data_base64:b.toString('base64')}));return h;};
 const v2=candidate(),v1=input();
 for(const x of [v1,v2]){
  const frame=x.sources.find(s=>s.kind==='frame');change(x,frame.id,p=>Object.assign(p,{sha256:hash,bytes:bytes.length,width:64,height:64}));
  if(x===v2)change(x,'ocr:2000',p=>p.image_sha256=hash);
 }
 const results=await Promise.all([verifyExtraction(v1),verifyExtraction(v2)]);assert(results.every(r=>r.status==='approved'));
 const records=results.flatMap(r=>r.records),documents=results.flatMap(r=>r.documents);
 await upload('image',bytes);for(const d of documents)await upload('evidence',Buffer.from(d.bytes));
 const m={schema_version:1,baseline_version:require('../content/compiled.json').version,source_commit:'a'.repeat(40),rules_version:'v2',parent_version:null,watchlist_revision:2,records,images:[{path:records[0].visit.screenshots[0].path,sha256:hash,bytes:bytes.length,width:64,height:64,mime_type:'image/png'}],verification_ids:documents.map(d=>d.sha256)};
 const h=await upload('manifest',Buffer.from(JSON.stringify(m)));
 const staged=await service.operation(op('release.stage',{manifest_sha256:h}));
 await service.operation(op('release.commit',{data_version:staged.data_version,expected_parent_version:null,expected_pointer_etag:null}));
 const reader=createReadModel({bucket}),state=await reader.state();
 assert.equal(catalogData('verified',state.catalog).shops.filter(s=>s.city==='北京').length,17);
 const broken=structuredClone(documents[1].document);broken.verification.provenance[2].poi_id='B0K6MSBN7U';
 const bad=await upload('evidence',Buffer.from(JSON.stringify(broken)));
 const badM=structuredClone(m);badM.verification_ids[1]=bad;badM.records[1].review.verification_id=bad;
 const badHash=await upload('manifest',Buffer.from(JSON.stringify(badM)));
 await assert.rejects(()=>service.operation(op('release.stage',{manifest_sha256:badHash})),/verification_failed/);
 assert.equal((await service.current()).data_version,staged.data_version);
});
module.exports={candidate,change};
