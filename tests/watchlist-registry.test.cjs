'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const initial=require('../docs/architecture/FACT-31/watchlist.initial.json');
class Bucket {
 constructor(){this.values=new Map();this.n=0;}
 async get(key){const item=this.values.get(key);return item?{key,etag:item.etag,json:async()=>structuredClone(item.value)}:null;}
 async put(key,body,{onlyIf}={}){const old=this.values.get(key);const create=onlyIf instanceof Headers&&onlyIf.get('If-None-Match')==='*';if(create?!!old:onlyIf?.etagMatches!==old?.etag)return null;const etag='e'+(++this.n);this.values.set(key,{value:JSON.parse(body),etag});return {etag};}
}
const uid='999123', bvid='BV1abcde2345';
function operation(){const w=structuredClone(initial);w.sources.push({uid,name:'fixture',profile_url:`https://space.bilibili.com/${uid}`,enabled:true,collection_scope:'beijing',season_ids:[]});return {schema_version:1,operation:'watchlist.sync',request_id:crypto.randomUUID(),github:{repo:'Adrian-share/foodmap',ref:'fact-18/beijing-content-003',path:'content/watchlists/beijing.json',commit_sha:'a'.repeat(40),sha256:'b'.repeat(64),observed_at:'2026-11-16T15:00:00Z'},watchlist:w,expected_registry_revision:0};}
const req=body=>new Request('https://test/api/admin/content-ingest',{method:body?'POST':'GET',headers:{Authorization:'Bearer test','content-type':'application/json'},body:body?JSON.stringify(body):undefined});
test('W2 registry CAS activates ingestion and catalog, preserves old identities after disable',async()=>{
 const {createIngestionService}=require('../content/ingestion.cjs');
 const {registeredConfig,assess}=require('../content/catalog.cjs');
 const service=createIngestionService(),bucket=new Bucket(),env={FOODMAP_INGEST_TOKEN:'test',CONTENT_UPDATES:bucket};
 const op=operation();
 let r=await service.handle(req(op),env);assert.equal(r.status,200);const receipt=await r.json();assert.equal(receipt.status,'committed');assert.equal(receipt.registry_revision,1);
 const same=await(await service.handle(req(op),env)).json();assert.deepEqual(same,receipt);
 assert.equal((await service.handle(req({...op,watchlist:{...op.watchlist,city:'上海'}}),env)).status,409);
 const snapshot={schema:1,updated_at:'2026-11-16T15:00:00Z',discoveries:[{bvid,creator_uid:uid,owner_verified:true,source:'https://api.bilibili.com/x/web-interface/view?bvid='+bvid,discovered_at:'2026-11-16T15:00:00Z'}],accounts:[],seasons:[],videos:[]};
 assert.equal((await service.handle(req(snapshot),env)).status,200);
 const registry=bucket.values.get('private/watchlist-v1.json').value;
 assert.ok(registeredConfig({creator_uids:[]},registry).creator_uids.includes(uid));
 const record=structuredClone(require('../content/runtime.cjs').records.find(r=>r.published&&r.video.metadata_status==='verified'));
 record.creator.uid=uid;record.video.owner_uid=uid;
 assert.ok(assess(record,{creator_uids:[]}).includes('作者归属未核准'));
 assert.ok(!assess(record,{creator_uids:[],registry}).includes('作者归属未核准'));
 const stale=operation();stale.github.commit_sha='c'.repeat(40);assert.equal((await service.handle(req(stale),env)).status,409);
 const disabled=operation();disabled.expected_registry_revision=1;disabled.github.commit_sha='d'.repeat(40);disabled.watchlist.sources.at(-1).enabled=false;
 assert.equal((await service.handle(req(disabled),env)).status,200);
 assert.equal((await service.handle(req(snapshot),env)).status,200);
 const state=await service.privateState(env);assert.ok(state.ledger.creators.some(c=>c.uid===uid));
 const query={schema_version:1,operation:'receipt.get',request_id:crypto.randomUUID(),target_request_id:op.request_id};
 assert.deepEqual(await(await service.handle(req(query),env)).json(),receipt);
});
test('W3 strict list validation rejects command, wrong profile, duplicate UID, link ownership',()=>{
 const {validateWatchlist}=require('../content/watchlist.cjs');
 for(const change of [w=>w.sources[0].command='bash',w=>w.sources[0].profile_url='https://evil.test',w=>w.sources.push(w.sources[0]),w=>w.video_links=[{uid:'123',url:`https://www.bilibili.com/video/${bvid}/`}],w=>w.sources[0].uid=123]){
  const w=structuredClone(initial);change(w);assert.throws(()=>validateWatchlist(w));
 }
});
