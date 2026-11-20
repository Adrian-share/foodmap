// fixture=true for execution: genuine immutable public baseline, memory bucket only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {Bucket,sha}=require('./publication.cjs'),{canonical}=require('../../content/protocol.cjs');
const {createPublicationService}=require('../../content/publication.cjs'),{createReadModel}=require('../../content/read-model.cjs');
const raw=name=>fs.readFileSync(path.join(__dirname,name));
const empty=raw('approved-empty.manifest.json'),curve=raw('approved-curve.manifest.json'),verification=raw('approved-curve.verification.json'),image=raw('public-curve-frame.png');
const emptyVersion='v1-'+sha(empty),curveVersion='v1-'+sha(curve),curveManifest=JSON.parse(curve);
const operation=(name,extra={})=>({schema_version:1,operation:name,request_id:crypto.randomUUID(),...extra});
async function sixteen(){
 const bucket=new Bucket(),pub=createPublicationService({bucket,probe:async()=>true}),reader=createReadModel({bucket});
 await bucket.put('private/watchlist-v1.json',JSON.stringify({registry_revision:2,accepted_sources:['3325087','544336675','613814196','24159340'].map(uid=>({uid}))}));
 await bucket.put('private/evidence/'+sha(verification)+'.json',verification);await bucket.put('private/blobs/image/'+sha(image),image);
 async function freeze(bytes){const hash=sha(bytes);await bucket.put('private/manifests/'+hash+'.json',bytes);return pub.operation(operation('release.stage',{manifest_sha256:hash}));}
 async function commit(version,rollback=false){const p=await pub.current();return pub.operation(operation(rollback?'release.rollback':'release.commit',{data_version:version,expected_parent_version:p?.data_version||null,expected_pointer_etag:p?.pointer_etag||null,...(rollback?{reason:'isolated relation ATDD rollback'}:{})}));}
 await freeze(empty);await commit(emptyVersion);await freeze(curve);await commit(curveVersion);
 async function prepare(fixtures,aliases={},proofs=[]){
  const manifest={...structuredClone(curveManifest),source_commit:'a'.repeat(40),parent_version:curveVersion,records:[...structuredClone(curveManifest.records),...fixtures.flatMap(f=>f.result.records)],images:[...structuredClone(curveManifest.images)],verification_ids:[...curveManifest.verification_ids,...fixtures.flatMap(f=>f.result.documents.map(d=>d.sha256))],store_aliases:aliases,store_alias_evidence:proofs};
  for(const f of fixtures){for(const d of f.result.documents)await bucket.put('private/evidence/'+d.sha256+'.json',d.bytes);const shot=f.result.records[0].visit.screenshots[0];if(!manifest.images.some(i=>i.path===shot.path))manifest.images.push({path:shot.path,sha256:sha(f.raw),mime_type:'image/png',bytes:f.raw.length,width:64,height:64});await bucket.put('private/blobs/image/'+sha(f.raw),f.raw);}
  const bytes=Buffer.from(JSON.stringify(canonical(manifest))),hash=sha(bytes);await bucket.put('private/manifests/'+hash+'.json',bytes);return {manifest,bytes,version:'v1-'+hash,stage:()=>pub.operation(operation('release.stage',{manifest_sha256:hash}))};
 }
 return {bucket,pub,reader,prepare,commit,curveVersion,emptyVersion,original:await reader.snapshot(curveVersion)};
}
module.exports={sixteen,curveVersion,curveManifest,originalHashes:{curve:sha(curve),empty:sha(empty),verification:sha(verification),image:sha(image)}};
