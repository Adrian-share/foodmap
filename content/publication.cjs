'use strict';
const {validate,fail,encode,sha,equal}=require('./protocol.cjs');
const {verifyExtraction}=require('./verification.cjs');
const SITE='https://foodmap.shareworld.fun',CURRENT='public/current.json',CHUNK=524288;
const VERSION=/^v1-[a-f0-9]{64}$/;
const meta={httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}};
const absent=()=>new Headers({'If-None-Match':'*'});
const blobKey=(kind,hash)=>kind==='image'?'private/blobs/image/'+hash:'private/'+(kind==='manifest'?'manifests':'evidence')+'/'+hash+'.json';
function imageInfo(bytes,mime){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let width=0,height=0;
 if(mime==='image/png'&&bytes.length>=45&&Array.from(bytes.slice(0,8)).join(',')==='137,80,78,71,13,10,26,10'&&v.getUint32(8)===13&&String.fromCharCode(...bytes.slice(12,16))==='IHDR'&&String.fromCharCode(...bytes.slice(-8,-4))==='IEND'){width=v.getUint32(16);height=v.getUint32(20);}
 else if(mime==='image/jpeg'&&bytes.length>10&&v.getUint16(0)===0xffd8&&v.getUint16(bytes.length-2)===0xffd9){let i=2;while(i+4<bytes.length){if(bytes[i]!==255)break;const marker=bytes[i+1];if(marker===0xda)break;const n=v.getUint16(i+2);if(n<2||i+2+n>bytes.length)break;if([0xc0,0xc1,0xc2].includes(marker)&&n>=8){height=v.getUint16(i+5);width=v.getUint16(i+7);break;}i+=n+2;}}
 else if(mime==='image/webp'&&bytes.length>=30&&String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&v.getUint32(4,true)+8===bytes.length&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'){
  const type=String.fromCharCode(...bytes.slice(12,16));if(type==='VP8X'){width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}else if(type==='VP8 '&&bytes.length>=30&&bytes[23]===0x9d&&bytes[24]===0x01&&bytes[25]===0x2a){width=v.getUint16(26,true)&0x3fff;height=v.getUint16(28,true)&0x3fff;}else if(type==='VP8L'&&bytes[20]===0x2f){const bits=v.getUint32(21,true);width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;}
 }
 if(width<32||height<32||width>8192||height>8192||width*height>32*1024*1024)fail('invalid_image');
 return {width,height};
}
const ext=mime=>({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]);
async function readBytes(object,max=16*1024*1024){if(!object)fail('missing_blob');if(object.size>max)fail('blob_too_large',413);const bytes=new Uint8Array(await object.arrayBuffer());if(bytes.length>max)fail('blob_too_large',413);return bytes;}
function createPublicationService({bucket,probe,baselineVersion=require('./compiled.json').version,clock=()=>new Date()}={}){
 if(!bucket)fail('storage_unavailable',503);
 const date=()=>clock().toISOString();
 async function json(key){const obj=await bucket.get(key);return obj?{object:obj,value:await obj.json()}:null;}
 async function immutable(key,bytes,options=meta){const old=await bucket.get(key);if(old){if(await sha(await readBytes(old))!==await sha(bytes))fail('idempotency_conflict',409);return old;}const written=await bucket.put(key,bytes,{...options,onlyIf:absent()});if(!written)return immutable(key,bytes,options);return written;}
 async function current(){const c=await json(CURRENT);if(!c)return null;validate('pointer',c.value);return {...c.value,pointer_etag:c.object.etag};}
 function receipt(op,status,extra={}){return {schema_version:1,request_id:op.request_id,operation:op.operation,status,checked_at:date(),data_version:null,pointer_etag:null,registry_revision:null,missing_chunks:[],error_code:null,...extra};}
 async function save(op,value){validate('operation_receipt',value);await bucket.put('private/receipts/'+op.request_id+'.json',JSON.stringify(value),meta);return value;}
 async function lookup(id){
  const found=await json('private/receipts/'+id+'.json');if(found&&['complete','committed'].includes(found.value.status))return found.value;
  const prepared=await json('private/requests/'+id+'.json');if(!prepared)return null;
  const op=prepared.value.op;
  if(['release.commit','release.rollback'].includes(op.operation)){
   const target=await json('private/transitions/'+id+'.json');
   if(target){let cursor=await current();let transition=cursor?.transition_id;const seen=new Set();
    while(transition){if(seen.has(transition)||seen.size>10000)fail('transition_chain_corrupt',503);seen.add(transition);if(transition===id)return save(op,receipt(op,'committed',{data_version:target.value.target_version,pointer_etag:cursor.transition_id===id?cursor.pointer_etag:null}));const link=await json('private/transitions/'+transition+'.json');if(!link)fail('transition_chain_corrupt',503);validate('transition',link.value);transition=link.value.previous_transition_id;}
    if((cursor?.generation||0)!==target.value.parent_generation||(cursor?.pointer_etag||null)!==target.value.expected_pointer_etag)return save(op,receipt(op,'rejected',{error_code:'version_conflict'}));
   }
  }
  return found?.value||receipt(op,'prepared');
 }
 async function chunk(op){
  const {blob_kind:kind,blob_sha256:hash,mime_type:mime,total_bytes:total,chunk_index:index,chunk_count:count}=op;
  if(count!==Math.ceil(total/CHUNK)||index>=count||kind==='image'&&(total>8*1024*1024||!ext(mime))||kind!=='image'&&mime!=='application/json')fail('invalid_chunk');
  let bytes;try{bytes=Uint8Array.from(atob(op.data_base64),c=>c.charCodeAt(0));}catch{fail('invalid_base64');}
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  if(btoa(binary)!==op.data_base64||bytes.length!==Math.min(CHUNK,total-index*CHUNK)||await sha(bytes)!==op.chunk_sha256)fail('hash_mismatch');
  const prefix='private/staging/'+kind+'/'+hash+'/';
  await immutable(prefix+'meta.json',encode({kind,hash,mime,total,count}));
  await immutable(prefix+index,bytes,{httpMetadata:{contentType:'application/octet-stream',cacheControl:'private, no-store'}});
  const parts=[],missing=[];
  for(let i=0;i<count;i++){const p=await bucket.get(prefix+i);if(!p)missing.push(i);else parts.push(await readBytes(p,CHUNK));}
  if(missing.length)return save(op,receipt(op,'prepared',{missing_chunks:missing}));
  const full=new Uint8Array(total);let offset=0;for(const p of parts){if(offset+p.length>total)fail('hash_mismatch');full.set(p,offset);offset+=p.length;}
  if(offset!==total||await sha(full)!==hash)fail('hash_mismatch');
  let customMetadata={};
  if(kind==='image'){const dimensions=imageInfo(full,mime);customMetadata={width:String(dimensions.width),height:String(dimensions.height),sha256:hash,mime_type:mime};}
  else{let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(full));}catch{fail('invalid_json_blob');}if(kind==='manifest')validate('manifest',value);else if(value?.schema_version!==1||!value.input||!value.verification)fail('invalid_evidence');}
  await immutable(blobKey(kind,hash),full,{httpMetadata:{contentType:mime,cacheControl:'private, no-store'},customMetadata});
  return save(op,receipt(op,'complete'));
 }
 async function manifest(hash){const bytes=await readBytes(await bucket.get(blobKey('manifest',hash)));if(await sha(bytes)!==hash)fail('hash_mismatch');let m;try{m=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid_manifest');}validate('manifest',m);if(m.baseline_version!==baselineVersion)fail('baseline_version_conflict',409);return {m,bytes};}
 async function checkImages(m,network){
  for(const image of m.images){const bytes=await readBytes(await bucket.get(blobKey('image',image.sha256)),8*1024*1024);if(bytes.length!==image.bytes||await sha(bytes)!==image.sha256)fail('hash_mismatch');const info=imageInfo(bytes,image.mime_type);if(info.width!==image.width||info.height!==image.height||image.path!=='content/images/'+image.sha256+'.'+ext(image.mime_type))fail('invalid_image');
   const key='public/images/'+image.sha256+'.'+ext(image.mime_type);
   await immutable(key,bytes,{httpMetadata:{contentType:image.mime_type,cacheControl:'public, max-age=31536000, immutable'},customMetadata:{sha256:image.sha256}});
   if(network){const route='/'+image.path;
    if(probe){if(await probe(route,image)!==true)fail('image_unavailable',503);}
    else{let response;try{response=await fetch(SITE+route,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{...require('./http-identity.cjs'),'Cache-Control':'no-cache'}});}catch{fail('image_unavailable',503);}if(!response.ok||response.headers.get('content-type')?.split(';')[0]!==image.mime_type||Number(response.headers.get('content-length'))!==image.bytes)fail('image_unavailable',503);const received=await readBytes({size:image.bytes,arrayBuffer:()=>response.arrayBuffer()},8*1024*1024);if(await sha(received)!==image.sha256)fail('image_unavailable',503);}
   }
  }
 }
 async function stage(op){
  const {m,bytes}=await manifest(op.manifest_sha256);
  const registry=(await json('private/watchlist-v1.json'))?.value;
  if(!registry||m.watchlist_revision>registry.registry_revision)fail('registry_revision_conflict',409);
  const ids=new Set(m.verification_ids);if(ids.size!==m.verification_ids.length||new Set(m.images.map(i=>i.path)).size!==m.images.length)fail('duplicate_resource');
  const verified=new Map();
  for(const id of ids){const raw=await readBytes(await bucket.get(blobKey('evidence',id)));if(await sha(raw)!==id)fail('hash_mismatch');const doc=JSON.parse(new TextDecoder().decode(raw));const result=await verifyExtraction(doc.input);if(result.status!=='approved'||result.records.length!==1||JSON.stringify(result.documents[0].document.verification)!==JSON.stringify(doc.verification)||result.documents[0].sha256!==id)fail('verification_failed');const record=result.records[0];verified.set(id,record);}
  const frozen=require('./compiled.json');
  const owners=new Map(frozen.ledger.videos.map(v=>[v.bvid,v.creator_uid]));
  const keys=new Set();
  for(const record of m.records){if(owners.has(record.video.bvid)&&owners.get(record.video.bvid)!==record.creator.uid)fail('wrong_owner');const id=record.review.verification_id;if(!ids.has(id)||!equal(record,verified.get(id))||!(m.rules_version==='v1'?record.review.rules_version==='v1':m.rules_version==='v2'&&['v1','v2'].includes(record.review.rules_version))||!registry.accepted_sources?.some(s=>s.uid===record.creator.uid))fail('verification_failed');const key=record.video.bvid+':'+record.video.part+':'+record.visit.id;if(keys.has(key))fail('duplicate_visit');keys.add(key);for(const s of record.visit.screenshots){const image=m.images.find(i=>i.path===s.path&&i.sha256===s.sha256);const evidence=JSON.parse(new TextDecoder().decode(await readBytes(await bucket.get(blobKey('evidence',id)))));const f=evidence.input.sources.find(s=>s.kind==='frame'&&s.payload.sha256===image?.sha256)?.payload;if(!image||!f||image.bytes!==f.bytes||image.width!==f.width||image.height!==f.height||image.mime_type!==f.mime_type)fail('missing_blob');}}
  if(ids.size!==m.records.length||m.images.some(i=>!m.records.some(r=>r.visit.screenshots.some(s=>s.path===i.path))))fail('unreferenced_resource');
  require('./state.cjs').createContentState({...frozen,config:{...frozen.config,creator_uids:[...new Set([...frozen.config.creator_uids,...m.records.map(r=>r.creator.uid)])]},batches:[...frozen.batches,{batch_id:'dynamic-v1',version:'v1-'+op.manifest_sha256,records:m.records}]},{...require('./public-assets.json'),...Object.fromEntries(m.images.map(i=>['/'+i.path,{sha256:i.sha256,type:i.mime_type}]))});
  await checkImages(m,true);
  const version='v1-'+op.manifest_sha256;
  await immutable('public/releases/'+version+'.json',bytes);
  await bucket.put('private/staged/'+version+'.json',JSON.stringify({checked_at:date()}),meta);
  return save(op,receipt(op,'complete',{data_version:version,registry_revision:registry.registry_revision}));
 }
 async function commit(op){
  const target=await bucket.get('public/releases/'+op.data_version+'.json');if(!target)fail('missing_blob');
  const {m}=await manifest(op.data_version.slice(3));
  if(await sha(await readBytes(target))!==op.data_version.slice(3))fail('hash_mismatch');
  const parent=await current();
  if((parent?.data_version||null)!==op.expected_parent_version||(parent?.pointer_etag||null)!==op.expected_pointer_etag)fail('version_conflict',409);
  if(op.operation==='release.commit'&&m.parent_version!==op.expected_parent_version)fail('version_conflict',409);
  if(!await bucket.get('private/staged/'+op.data_version+'.json'))fail('verification_failed');
  // Probe again immediately before CAS; a successful stage is never sufficient by itself.
  await checkImages(m,true);
  const priorTransition=await json('private/transitions/'+op.request_id+'.json');
  const transition=priorTransition?.value||{schema_version:1,transition_id:op.request_id,previous_transition_id:parent?.transition_id||null,parent_generation:parent?.generation||0,target_version:op.data_version,expected_pointer_etag:op.expected_pointer_etag,operation:op.operation,prepared_at:date()};validate('transition',transition);
  await immutable('private/transitions/'+op.request_id+'.json',encode(transition));
  const pointer={schema_version:1,generation:transition.parent_generation+1,data_version:op.data_version,manifest_sha256:op.data_version.slice(3),previous_data_version:parent?.data_version||null,transition_id:op.request_id,committed_at:date()};validate('pointer',pointer);
  const written=await bucket.put(CURRENT,JSON.stringify(pointer),{...meta,onlyIf:parent?{etagMatches:parent.pointer_etag}:absent()});
  if(!written)fail('version_conflict',409);
  return save(op,receipt(op,'committed',{data_version:op.data_version,pointer_etag:written.etag}));
 }
 async function operation(op,raw=JSON.stringify(op)){
  validate('operation',op);if(encode(raw).length>2*1024*1024)fail('operation_too_large',413);
  if(op.operation==='receipt.get')return await lookup(op.target_request_id)||receipt(op,'not_found');
  const fingerprint=await sha(encode(raw)),key='private/requests/'+op.request_id+'.json';
  const previous=await json(key);
  if(previous&&previous.value.fingerprint!==fingerprint)fail('idempotency_conflict',409);
  if(!previous){const written=await bucket.put(key,JSON.stringify({fingerprint,op}),{...meta,onlyIf:absent()});if(!written)return operation(op,raw);}
  const old=await lookup(op.request_id);if(old&&['complete','committed'].includes(old.status))return old;
  if(op.operation==='blob.chunk')return chunk(op);
  if(op.operation==='release.stage')return stage(op);
  if(['release.commit','release.rollback'].includes(op.operation))return commit(op);
  if(op.operation==='service.heartbeat'){
   const previous=await json('private/service-v1.json');if(previous&&Date.parse(previous.value.heartbeat_at)>Date.parse(op.heartbeat_at))fail('stale_heartbeat',409);
   const result=await bucket.put('private/service-v1.json',JSON.stringify(op),{...meta,onlyIf:previous?{etagMatches:previous.object.etag}:absent()});if(!result)fail('heartbeat_conflict',409);return save(op,receipt(op,'committed'));
  }
  fail('unsupported_operation');
 }
 async function image(request){const path=new URL(request.url).pathname;if(!/^\/content\/images\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(path))return null;const obj=await bucket.get(path.replace('/content/','public/'));if(!obj)return null;return new Response(request.method==='HEAD'?null:obj.body,{headers:{'Content-Type':obj.httpMetadata.contentType,'Content-Length':String(obj.size),'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});}
 return {operation,current,image,lookup,manifest};
}
module.exports={createPublicationService,imageInfo,readBytes,blobKey,CURRENT,CHUNK,VERSION};
