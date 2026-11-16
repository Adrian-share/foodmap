'use strict';
const {validateWatchlist,validateGithub,object,fail}=require('./watchlist.cjs');
const KEY='private/watchlist-v1.json';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
async function digest(value){const bytes=new TextEncoder().encode(value);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function receipt(op,revision,status='committed'){return {schema_version:1,request_id:op.request_id,operation:op.operation,status,checked_at:new Date().toISOString(),data_version:null,pointer_etag:null,registry_revision:revision,missing_chunks:[],error_code:null};}
async function readRegistry(bucket){
 const obj=await bucket.get(KEY);if(!obj)return {object:null,value:null};
 const value=await obj.json();
 if(value.schema_version!==1||!Number.isSafeInteger(value.registry_revision)||!Array.isArray(value.accepted_sources)||!value.requests||!value.github)fail('registry_storage_unavailable',503);
 validateWatchlist(value.watchlist);validateGithub(value.github);
 return {object:obj,value};
}
function registryKnown(known,registry){return new Set([...known,...(registry?.accepted_sources||[]).map(s=>s.uid)]);}
async function operation(bucket,op,raw){
 if(!UUID.test(op.request_id||''))fail('invalid_request_id');
 const current=await readRegistry(bucket),previous=current.value;
 if(op.operation==='receipt.get'){
  object(op,['schema_version','operation','request_id','target_request_id']);
  if(op.schema_version!==1||!UUID.test(op.target_request_id))fail('invalid_receipt_query');
  return previous?.requests[op.target_request_id]?.receipt||receipt(op,null,'not_found');
 }
 if(op.operation!=='watchlist.sync')fail('unsupported_operation');
 // Request identity is checked before schema: the same ID may never change its bytes.
 const fingerprint=await digest(raw);
 if(previous?.requests[op.request_id]){
  if(previous.requests[op.request_id].fingerprint!==fingerprint)fail('idempotency_conflict',409);
  return previous.requests[op.request_id].receipt;
 }
 object(op,['schema_version','operation','request_id','github','watchlist','expected_registry_revision']);
 if(op.schema_version!==1||!Number.isSafeInteger(op.expected_registry_revision)||op.expected_registry_revision<0)fail('invalid_registry_revision');
 validateGithub(op.github);validateWatchlist(op.watchlist);
 const unchanged=previous?.github.commit_sha===op.github.commit_sha&&previous.github.sha256===op.github.sha256;
 if(unchanged){
  if(JSON.stringify(previous.watchlist)!==JSON.stringify(op.watchlist))fail('idempotency_conflict',409);
 }
 if((previous?.registry_revision||0)!==op.expected_registry_revision)fail('registry_revision_conflict',409);
 const revision=(previous?.registry_revision||0)+(unchanged?0:1);
 const accepted=new Map((previous?.accepted_sources||[]).map(s=>[s.uid,s]));
 for(const source of op.watchlist.sources)if(source.enabled||accepted.has(source.uid))accepted.set(source.uid,source);
 const result=receipt(op,revision);
 const value={schema_version:1,registry_revision:revision,github:op.github,watchlist:op.watchlist,accepted_sources:[...accepted.values()],requests:{...previous?.requests,[op.request_id]:{fingerprint,receipt:result}}};
 const onlyIf=current.object?{etagMatches:current.object.etag}:new Headers({'If-None-Match':'*'});
 const written=await bucket.put(KEY,JSON.stringify(value),{onlyIf,httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}});
 if(!written)fail('registry_revision_conflict',409);
 return result;
}
module.exports={KEY,readRegistry,registryKnown,operation};
