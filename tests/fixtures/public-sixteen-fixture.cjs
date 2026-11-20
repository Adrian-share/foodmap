// Isolated projection of genuine public 16 + independently checked OFFLINE C2 fixtures.
const fs=require('node:fs'),path=require('node:path');const {sha}=require('./publication.cjs');const {visit}=require('./store-identity.cjs');
const {createContentState,projectContentState}=require('../../content/state.cjs');const frozen=require('../../content/compiled.json');const {buildLedger}=require('../../content/ledger.cjs');
async function cohort(){
 const original=require('./public-sixteen.snapshot.json'),a=await visit({uid:'613814196',description:'第一条视频自己的描述'}),b=await visit({bvid:'BV1abcde2346',uid:'24159340',description:'第二条视频自己的描述'});
 const images={...a.images,...b.images};for(const [p,i] of Object.entries(original.images))if(!images[p])images[p]={...i,base64:fs.readFileSync(path.join(__dirname,'public-curve-frame.png')).toString('base64')};
 const extra=createContentState({batches:[{batch_id:'offline-identity-only',version:'1',records:[...a.result.records,...b.result.records].map(r=>({...r,review:{status:r.review.status,rules_version:r.review.rules_version}}))}],config:frozen.config},images);
 const version='v1-'+sha(JSON.stringify({fixture:true,parent:original.data_version,aliases:{OFFLINE_TAIFENG:'beijing-1'},records:extra.records}));
 let state=projectContentState({...structuredClone(original),version,data_version:version,images,records:[...structuredClone(original.records),...extra.records],batches:[...original.batches,...extra.batches],catalog:{...structuredClone(original.catalog),version,data_version:version,shops:[...structuredClone(original.catalog.shops),...extra.catalog.shops],visits:[...structuredClone(original.catalog.visits),...extra.catalog.visits]}},{OFFLINE_TAIFENG:'beijing-1'});
 const pinned=url=>{const u=new URL(url,'https://foodmap.shareworld.fun');u.searchParams.set('data_version',version);return u.pathname+u.search;};
 for(const r of state.records)r.detail_url=pinned(r.detail_url);for(const v of [...state.catalog.visits,...state.catalog.baseline_visits])v.detail_url=pinned(v.detail_url);
 state.ledger=buildLedger({snapshot:require('../../content/inventory/video-inventory-2026-11-12.json'),historical:require('../../content/inventory/creators-2026-11-11.json'),accounts:frozen.ledger.creators,records:state.records});for(const v of state.ledger.videos)for(const x of v.visits)x.map_url=pinned(x.map_url);
 return {fixture:true,state,original,a,b,version};
}
module.exports={cohort};
