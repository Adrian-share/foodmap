'use strict';
// Store identity is a versioned projection. Never mutate a C2 record or infer a merge.
const copy=value=>JSON.parse(JSON.stringify(value));
const baseline=copy(require('../data/catalog.json').shops.filter(s=>s.city==='北京'));
const {sha,encode,canonical,fail}=require('./protocol.cjs');
const norm=x=>String(x||'').normalize('NFKC').replace(/北京城区|北京市/g,'').replace(/[\s·，,。()（）]/g,'');
const brand=x=>norm(String(x||'').split(/[（(]/)[0]);
const ID=/^[A-Za-z0-9_-]{1,64}$/;
function distance(a,p){const [lng,lat]=String(p.location).split(',').map(Number),rad=Math.PI/180;return Math.hypot((lng-a.lng)*Math.cos(a.lat*rad),(lat-a.lat))*rad*6371000;}
function sameVenue(shop,poi){
 if(typeof poi.adname!=='string'||!poi.adname||typeof poi.name!=='string'||typeof poi.address!=='string'||poi.cityname!=='北京市'||!String(poi.name||'').normalize('NFKC').replace(/[\s·]/g,'').startsWith(brand(shop.name)))return false;
 const address=norm(poi.address),old=norm(shop.address);
 if(!address||!old.includes(address)||!/[0-9一二三四五六七八九十甲乙丙]+号/.test(address)||!old.includes(norm(poi.adname)))return false;
 const venue=poi.name.normalize('NFKC').split('(')[0];
 if(/酒店|宾馆|商场|购物中心/.test(venue)&&!/(餐厅|餐饮|饭庄|酒家|咖啡|酒楼|茶馆)/.test(venue))return false;
 if(/停车|出入口/.test(poi.name)||poi.typecode&&!/^05/.test(poi.typecode))return false;
 return distance(shop,poi)<=100;
}
async function validateStoreIdentity(value){
 const aliases=value.store_aliases,proofs=value.store_alias_evidence;
 if(!aliases||typeof aliases!=='object'||Array.isArray(aliases)||!Array.isArray(proofs)||Object.keys(aliases).length>10||proofs.length!==Object.keys(aliases).length)fail('invalid_store_identity');
 const targets=new Set(),seen=new Set();
 for(const [poi,id] of Object.entries(aliases)){
  if(!ID.test(poi)||typeof id!=='string'||targets.has(id))fail('invalid_store_identity_binding');targets.add(id);
  const shop=baseline.find(s=>s.id===id);if(!shop)fail('invalid_store_identity_target');
  const e=proofs.find(e=>e.poi_id===poi&&e.store_id===id);if(!e||seen.has(e.poi_id))fail('missing_store_identity_evidence');seen.add(e.poi_id);
  const keys=['poi_id','store_id','baseline_sha256','checked_at','source_url','retrieved_via','response_sha256','response_base64'];if(Object.keys(e).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(e,k)))fail('invalid_store_identity_evidence');
  if(await sha(encode(canonical(shop)))!==e.baseline_sha256||!Number.isFinite(Date.parse(e.checked_at)))fail('store_identity_baseline_mismatch');
  let official,via;try{official=new URL(e.source_url);via=new URL(e.retrieved_via);}catch{fail('invalid_store_identity_source');}
  if(official.origin!=='https://restapi.amap.com'||official.pathname!=='/v5/place/text'||official.username||official.password||official.hash||official.searchParams.get('region')!=='110000'||[...official.searchParams.keys()].some(k=>!['keywords','region','city_limit','page_size','page_num'].includes(k))||!official.searchParams.get('keywords')||via.origin!=='https://foodmap.shareworld.fun'||via.pathname!=='/api/content/poi'||via.username||via.password||via.hash||[...via.searchParams.keys()].some(k=>k!=='q')||via.searchParams.get('q')!==official.searchParams.get('keywords'))fail('invalid_store_identity_source');
  if(typeof e.response_base64!=='string'||e.response_base64.length>700000)fail('invalid_store_identity_response');
  let bytes;try{bytes=Uint8Array.from(atob(e.response_base64),c=>c.charCodeAt(0));}catch{fail('invalid_store_identity_response');}
  if(await sha(bytes)!==e.response_sha256)fail('store_identity_hash_mismatch');
  let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('invalid_store_identity_response');}
  if(raw.status!=='1'||!Array.isArray(raw.pois)||raw.pois.length>=20)fail('store_identity_incomplete_source');
  const matches=raw.pois.filter(p=>sameVenue(shop,p));if(matches.length!==1||matches[0].id!==poi)fail('store_identity_not_unique');
 }
 return {aliases:copy(aliases),evidence:copy(proofs),enabled:true};
}
async function resolveStoreIdentity(manifest,readParent,legacyAliases={}){
 let m=manifest;const seen=new Set();
 for(let depth=0;depth<10000;depth++){
  const a=Object.hasOwn(m,'store_aliases'),e=Object.hasOwn(m,'store_alias_evidence');
  if(a!==e)fail('missing_store_identity_evidence');
  if(a)return validateStoreIdentity(m);
  if(!m.parent_version)return {aliases:copy(legacyAliases),evidence:[],enabled:false};
  if(seen.has(m.parent_version))fail('store_identity_parent_cycle');seen.add(m.parent_version);
  m=await readParent(m.parent_version);if(!m)fail('store_identity_parent_unavailable',503);
 }
 fail('store_identity_chain_too_long');
}
function identityPending(record,aliases){
 const v=record.visit,poi=v.amap_poi_id;if(!poi||Object.hasOwn(aliases,poi))return [];
 const unresolved=baseline.filter(s=>!s.amap_poi_id&&!Object.values(aliases).includes(s.id));
 // These are review signals, never matching rules. A confirmed different POI
 // stays a different branch; proximity/name cannot create a binding.
 const risk=unresolved.some(s=>norm(v.store_name).includes(brand(s.name))||brand(s.name).includes(norm(v.store_name))||distance(s,{location:v.gcj02.lng+','+v.gcj02.lat})<100&&norm(s.address).includes(norm(v.address)));
 return risk?['store_identity_unresolved']:[];
}
function projectRecord(record,aliases){
 const v=record.visit,poi=v.amap_poi_id||Object.keys(aliases).find(k=>aliases[k]===v.store_id);
 const id=poi?(Object.hasOwn(aliases,poi)?aliases[poi]:'amap:'+poi):v.store_id;
 return {...record,visit:{...v,store_id:id,...(poi&&!v.amap_poi_id?{amap_poi_id:poi,amap_url:'https://ditu.amap.com/place/'+poi}:{})}};
}
module.exports={validateStoreIdentity,resolveStoreIdentity,identityPending,projectRecord,sameVenue,baseline,copy};
