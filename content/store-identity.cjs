'use strict';
// Store identity is a versioned projection. Never mutate a C2 record or infer a merge.
const copy=value=>JSON.parse(JSON.stringify(value));
const baseline=copy(require('../data/catalog.json').shops.filter(s=>s.city==='北京'));
const {sha,encode,canonical,fail}=require('./protocol.cjs');
const norm=x=>String(x||'').normalize('NFKC').replace(/北京城区|北京市/g,'').replace(/[\s·，,。()（）]/g,'');
const brand=x=>norm(String(x||'').split(/[（(]/)[0]);
const ID=/^[A-Za-z0-9_-]{1,64}$/;
function distance(a,p){const [lng,lat]=String(p.location).split(',').map(Number),rad=Math.PI/180;return Math.hypot((lng-a.lng)*Math.cos(a.lat*rad),(lat-a.lat))*rad*6371000;}
function venueName(value){
 const m=String(value||'').normalize('NFKC').trim().match(/^([^()]+?)(?:\(([^()]+)\))?$/);
 return m?{core:norm(m[1]),branch:norm(m[2])}:null;
}
function parentOrNonRestaurant(poi){
 if(poi.typecode&&!/^05/.test(poi.typecode)||poi.type&&!/^餐饮服务(?:[;；]|$)/.test(poi.type))return true;
 const core=venueName(poi.name)?.core||norm(poi.name);
 return /停车|出入口|文化中心|文化馆|博物馆|纪念馆|景区|酒店|宾馆|招待所|商场|购物中心/.test(core)&&!/(餐厅|餐饮|饭庄|酒家|咖啡|酒楼|茶馆)/.test(core);
}
function namesAgree(shop,poi){
 const old=venueName(shop.name),current=venueName(poi.name);
 if(!old||!current||old.core!==current.core)return false;
 if(old.branch)return old.branch===current.branch;
 if(!current.branch)return true;
 // A bare legacy name cannot authorize an arbitrary suffix/sub-brand. An
 // optional branch label must explicitly agree with the old concrete address.
 const place=current.branch.replace(/(?:分店|店)$/,'');
 return place.length>=2&&place!==old.core&&!/文化|博物|景区|酒店|宾馆|商场|购物中心/.test(place)&&norm(shop.address).includes(place);
}
function sameVenue(shop,poi){
 if(typeof poi.adname!=='string'||!poi.adname||typeof poi.name!=='string'||typeof poi.address!=='string'||poi.cityname!=='北京市'||parentOrNonRestaurant(poi)||!namesAgree(shop,poi))return false;
 const address=norm(poi.address),old=norm(shop.address);
 if(!address||!old.includes(address)||!/[0-9一二三四五六七八九十甲乙丙]+号/.test(address)||!old.includes(norm(poi.adname)))return false;
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
function registeredPois(input,record){
 return (Array.isArray(input?.sources)?input.sources:[]).filter(s=>s.kind==='poi').flatMap(s=>Array.isArray(s.payload?.pois)?s.payload.pois:[]).filter(p=>p.id===record.visit.amap_poi_id);
}
function distinctBranch(shop,visit){
 let address=norm(visit.address);const district=norm(visit.district);
 if(district&&address.startsWith(district))address=address.slice(district.length);
 const street=address.match(/^([\p{Script=Han}A-Za-z0-9]{2,30}?(?:胡同|街道|大街|大道|路|街|巷|条))(?=\d|\p{Script=Han}|$)/u)?.[1];
 const branch=norm(visit.branch_name),place=branch.replace(/(?:分店|店)$/,'');
 // Only records independently accepted by C2 reach stage. Clear separation of
 // branch, street/house and location removes a false legacy-overlap warning;
 // it never creates an alias or approves a visit.
 return !!street&&/[0-9一二三四五六七八九十甲乙丙]+号/.test(address)&&place.length>=2&&branch!==norm(visit.store_name)&&!norm(shop.name).includes(place)&&!norm(shop.address).includes(place)&&!norm(shop.address).includes(norm(street))&&distance(shop,{location:visit.gcj02.lng+','+visit.gcj02.lat})>100;
}
function identityPending(record,aliases,pois=[]){
 const v=record.visit,poi=v.amap_poi_id;
 if(pois.some(parentOrNonRestaurant))return ['store_identity_unresolved'];
 if(!poi||Object.hasOwn(aliases,poi))return [];
 const unresolved=baseline.filter(s=>!s.amap_poi_id&&!Object.values(aliases).includes(s.id));
 const risk=unresolved.some(s=>{
  const name=norm(v.store_name),branded=name.includes(brand(s.name))||brand(s.name).includes(name);
  const near=distance(s,{location:v.gcj02.lng+','+v.gcj02.lat})<100&&norm(s.address).includes(norm(v.address));
  return near||branded&&!distinctBranch(s,v);
 });
 return risk?['store_identity_unresolved']:[];
}
function projectRecord(record,aliases){
 const v=record.visit,poi=v.amap_poi_id||Object.keys(aliases).find(k=>aliases[k]===v.store_id);
 const id=poi?(Object.hasOwn(aliases,poi)?aliases[poi]:'amap:'+poi):v.store_id;
 return {...record,visit:{...v,store_id:id,...(poi&&!v.amap_poi_id?{amap_poi_id:poi,amap_url:'https://ditu.amap.com/place/'+poi}:{})}};
}
module.exports={validateStoreIdentity,resolveStoreIdentity,identityPending,registeredPois,projectRecord,sameVenue,baseline,copy};
