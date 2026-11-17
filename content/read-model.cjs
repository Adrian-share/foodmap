'use strict';
const frozen=require('./compiled.json'),assets=require('./public-assets.json');
const {createContentState}=require('./state.cjs');
const {createPublicationService,VERSION,readBytes}=require('./publication.cjs');
const {sha}=require('./protocol.cjs');
const {buildLedger}=require('./ledger.cjs');
const cleanRecord=r=>({...r,review:{status:'approved',...(r.review.rules_version?{rules_version:r.review.rules_version}:{})}});
function sanitize(state){
 const record=r=>({...r,review:{status:r.review?.status}});
 const visits=rows=>rows.map(v=>({...v,record:record(v.record)}));
 return {...state,records:state.records.filter(r=>r.published).map(record),catalog:{...state.catalog,visits:visits(state.catalog.visits),baseline_visits:visits(state.catalog.baseline_visits||[])},ledger:{creators:state.ledger.creators.filter(c=>c.counts.published).map(c=>({uid:c.uid,name:c.name,profile_url:c.profile_url,counts:{published:c.counts.published,searchable_stores:c.counts.searchable_stores}})),videos:state.ledger.videos.filter(v=>v.status==='published').map(v=>({bvid:v.bvid,creator_uid:v.creator_uid,url:v.url,title:v.title,bilibili_published_at:v.bilibili_published_at,included_at:v.included_at,status:'published',visits:v.visits.filter(x=>x.published)}))},images:Object.fromEntries(Object.entries(state.images).map(([path,image])=>[path,{sha256:image.sha256,type:image.type}]))};
}
function createReadModel({bucket,baseline=require('./runtime.cjs')}={}){
 async function state(version){
  if(!bucket){if(version&&version!==baseline.version)throw Object.assign(Error('version_expired'),{status:409});return {...baseline,data_version:baseline.version,catalog:{...baseline.catalog,data_version:baseline.version}};}
  const service=createPublicationService({bucket});
  const current=version?null:await service.current();const selected=version||current?.data_version;
  if(!selected||selected===baseline.version)return {...baseline,data_version:baseline.version,catalog:{...baseline.catalog,data_version:baseline.version}};
  if(!VERSION.test(selected))throw Object.assign(Error('version_expired'),{status:409});
  const obj=await bucket.get('public/releases/'+selected+'.json');if(!obj)throw Object.assign(Error('version_expired'),{status:409});
  const bytes=await readBytes(obj);if(await sha(bytes)!==selected.slice(3))throw Object.assign(Error('snapshot_unavailable'),{status:503});
  const manifest=JSON.parse(new TextDecoder().decode(bytes));require('./protocol.cjs').validate('manifest',manifest);if(manifest.baseline_version!==frozen.version)throw Object.assign(Error('baseline_version_conflict'),{status:503});
  for(const image of manifest.images){const obj=await (bucket.head?bucket.head('public/images/'+image.path.split('/').pop()):bucket.get('public/images/'+image.path.split('/').pop()));if(!obj||obj.size!==image.bytes)throw Object.assign(Error('image_unavailable'),{status:503});}
  const images={...assets};for(const image of manifest.images)images['/'+image.path]={sha256:image.sha256,type:image.mime_type};
  const config={...frozen.config,creator_uids:[...new Set([...frozen.config.creator_uids,...manifest.records.map(r=>r.creator.uid)])]};
  const data=createContentState({...frozen,config,version:selected,batches:[...frozen.batches,{batch_id:'dynamic-v1',version:selected,enabled:true,records:manifest.records.map(cleanRecord)}]},images);
  for(const visit of [...data.catalog.visits,...data.catalog.baseline_visits])visit.detail_url+='&data_version='+encodeURIComponent(selected);
  for(const record of data.records)record.detail_url+='&data_version='+encodeURIComponent(selected);
  // Reuse the same ledger builder, preserving all 92 historical identities.
  data.ledger=buildLedger({snapshot:require('./inventory/video-inventory-2026-11-12.json'),historical:require('./inventory/creators-2026-11-11.json'),access:require('./inventory/access-2026-11-15.json'),accounts:baseline.ledger.creators,records:data.records});
  data.data_version=selected;data.catalog.data_version=selected;
  return data;
 }
 async function snapshot(version){return sanitize(await state(version));}
 async function current(){return bucket?await createPublicationService({bucket}).current():null;}
 return {state,snapshot,current};
}
// MCP reads only the fixed public site's sanitized snapshot, never private state.
function createRemoteReadModel({origin='https://foodmap.shareworld.fun',request=fetch}={}){
 const base=new URL(origin);if(base.origin!=='https://foodmap.shareworld.fun'&&!(base.protocol==='http:'&&['localhost','127.0.0.1'].includes(base.hostname)))throw Error('invalid_snapshot_origin');
 async function get(path){const r=await request(new URL(path,base),{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{...require('./http-identity.cjs'),'Cache-Control':'no-cache'}});if(!r.ok)throw Error('snapshot_unavailable');const length=Number(r.headers.get('content-length'));if(length>32*1024*1024)throw Error('snapshot_too_large');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>32*1024*1024)throw Error('snapshot_too_large');return JSON.parse(new TextDecoder().decode(bytes));}
 return {async state(){const pointer=await get('/api/content/current');const version=pointer.data_version;const value=await get('/api/content/snapshot?'+new URLSearchParams({data_version:version}));if(value.data_version!==version||value.version!==version||!value.catalog||!value.images||!Array.isArray(value.records))throw Error('snapshot_version_mismatch');return value;}};
}
module.exports={createReadModel,createRemoteReadModel,sanitize};
