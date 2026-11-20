'use strict';
const {sha,encode}=require('./protocol.cjs');
const norm=s=>String(s||'').normalize('NFKC').replace(/[\s，,。·、（）()：:]/g,'');
// A conservative fallback for single-venue descriptions. Never infer a street
// from Pi's address_hint, and never use result ordering to disambiguate a POI.
function streetOf(poi){
 const address=String(poi.address||'').replace(/^北京市/,'').replace(new RegExp('^'+(poi.adname||'(?!)')),'');
 return address.match(/^([\p{Script=Han}A-Za-z0-9]{2,30}?(?:胡同|街道|大街|大道|路|街|巷|条))(?=\d|\p{Script=Han}|$)/u)?.[1]?.replace(/胡同$/,'')||null;
}
async function descriptionStreet({data,meta,visit:v,visits,pois,frames,lines}){
 const desc=data?.desc,brand=norm(v.store_name);
 if(typeof desc!=='string'||brand.length<2||!norm(desc).startsWith(brand)||data.pages?.length!==1||visits.length!==1)return null;
 // Cross-venue scope is intentionally pending even when a model claims a split.
 if(/另一|另外|分别|两家|多家|多店|第一家|第二家|以及|[;；]|与|和|不是|并非|不在|搬迁|歇业|停业/.test(desc))return null;
 const all=[...new Map(pois.map(p=>[p.poi.id,p])).values()];
 const branded=all.filter(({poi:q})=>norm(q.name).startsWith(brand));
 const streets=[...new Set(branded.map(({poi:q})=>streetOf(q)).filter(s=>s&&norm(desc).includes(norm(s))))];
 if(streets.length!==1)return null;
 const street=streets[0];
 const matches=branded.filter(({poi:q})=>q.cityname==='北京市'&&streetOf(q)===street);
 if(matches.length!==1)return null;
 const match=matches[0],q=match.poi;
 if(!v.poi_candidates.includes(q.id)||!norm(q.name).includes(norm(v.branch_name))||!norm(v.address_hint).includes(norm(q.address)))return null;
 const otherStreets=branded.flatMap(({poi:q})=>[...String(q.address).matchAll(/([\p{Script=Han}A-Za-z]{2,30}?(?:胡同|街道|大街|大道|路|街|巷|条))/gu)].map(m=>m[1].replace(/胡同$/,''))).filter(s=>s!==street);
 // Registered subtitle/native OCR text can veto the description; low confidence
 // OCR is not promoted into address evidence. The description's house number,
 // when present, must also agree with AMap's authoritative address.
 const text=[desc,...lines.map(l=>l.content)];
 if(text.some(t=>otherStreets.some(s=>norm(t).includes(norm(s)))))return null;
 const house=norm(q.address).match(/\d+(?:-\d+)?号/)?.[0];
 if(text.some(t=>{const n=norm(t),i=n.indexOf(norm(street));if(i<0)return false;const h=n.slice(i+norm(street).length).match(/^(?:胡同)?(\d+(?:-\d+)?号)/)?.[1];return h&&h!==house;}))return null;
 if(!v.description||!desc.includes(v.description)||/[<>\u0000-\u001f]/.test(v.description))return null;
 const frame=frames[0];if(!frame)return null;
 const proof=(role,s)=>({role,evidence_id:s.id,sha256:s.sha256});
 return {match,line:{from:0,source:meta},provenance:[
  {...proof('official_description_street',meta),street,description_sha256:await sha(encode(desc))},
  {...proof('original_frame',frame),image_sha256:frame.payload.sha256},
  {...proof('unique_amap_street_match',match.source),poi_id:q.id,street,
   excluded_pois:all.filter(p=>p.poi.id!==q.id).map(({poi:p})=>({id:p.id,reason:!norm(p.name).startsWith(brand)?'different_name':p.cityname!=='北京市'?'different_city':'different_street'}))}
 ]};
}
module.exports={descriptionStreet,streetOf};
