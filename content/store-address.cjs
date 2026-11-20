'use strict';
// A finite address grammar and hierarchical comparison, not a store matcher.
const {streetOf}=require('./description-street.cjs');
const text=x=>String(x||'').normalize('NFKC').toUpperCase().replace(/\s+/g,'');
const digits={'零':0,'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
function number(x){if(/^\d+$/.test(x))return String(Number(x));if(x==='十')return '10';if(/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(x)){const [a,b]=x.split('十');return String((digits[a]||1)*10+(digits[b]||0));}return [...x].every(c=>Object.hasOwn(digits,c))?String(Number([...x].map(c=>digits[c]).join(''))):null;}
const ordinal=x=>x.replace(/[0-9零一二三四五六七八九十]+/g,x=>number(x)??'?');
const N='[0-9零一二三四五六七八九十]+';
const floorPatterns=[new RegExp('(?:地下|负)('+N+')层'),/B(\d+)(?=-|层|F|$)/,new RegExp('F('+N+')(?:层)?'),new RegExp('('+N+')(?:层|F)')];
function parseAddress(value){
 const address=typeof value==='string'?value:value.address;
 let raw=text(address).replace(/北京城区|北京市/g,'');
 const district=text(value.district)||raw.match(/^([\p{Script=Han}]{1,6}区)(?=[·•]|[\p{Script=Han}])/u)?.[1]||null;
 // Only navigation parentheses are omitted. Components inside other brackets
 // stay visible to the grammar; a walking distance never becomes a shop unit.
 raw=raw.replace(/\([^()]*(?:步行|地铁|斜对面|路口|交叉口|往里|后门)[^()]*\)/g,'');
 if(/\/(?:.*(?:步行|路口|往里|米))/.test(raw))raw=raw.split('/')[0];
 let core=raw.split(/[·•]/).filter(Boolean).pop()||'';
 if(district&&core.startsWith(district))core=core.slice(district.length);
 const out={district,street:null,house:null,courtyard:false,site:null,building:null,floor:null,unit:null,invalid:null};
 if(!core){out.invalid='ambiguous_or_missing_address';return out;}
 const street=streetOf({address:core,adname:''});
 if(street){out.street=text(street);core=core.slice(out.street.length);if(core.startsWith('胡同'))core=core.slice(2);const h=core.match(new RegExp('^([甲乙丙丁]?'+N+')号(院)?'));if(h){out.house=ordinal(h[1]);out.courtyard=!!h[2];core=core.slice(h[0].length);if(core.startsWith('楼')){out.building=out.house;core=core.slice(1);}}}
 const sitePattern=/^([\p{Script=Han}A-Z]+?(?:SOHO|购物中心|大厦|中心|广场|酒店|宾馆|招待所|商场))/u;
 let site=core.match(sitePattern);if(site){out.site=site[1];core=core.slice(site[0].length);}
 const building=core.match(new RegExp('([A-Z]?'+N+'|[A-Z])(?:号楼|栋|座|号商场)'));
 if(building){out.building=ordinal(building[1]);core=core.replace(building[0],'');}
 if(!site){site=core.match(sitePattern);if(site){out.site=site[1];core=core.slice(site[0].length);}}
 for(const pattern of floorPatterns){const m=core.match(pattern);if(!m)continue;out.floor=(/^(?:B|地下|负)/.test(m[0])?'-':'')+(number(m[1])??'?');core=core.replace(m[0],'');break;}
 const explicit=core.match(/(?:铺位|商铺|室号)([A-Z]?\d+[A-Z]?)|([A-Z]?\d+[A-Z]?)(?:号铺|店铺|铺|室)/);
 if(explicit){out.unit=explicit[1]||explicit[2];core=core.replace(explicit[0],'');}
 else if(out.floor){const unit=core.match(/^-?([A-Z]?\d+[A-Z]?)$/);if(unit){out.unit=unit[1];core='';}}
 if([out.house,out.building,out.floor,out.unit].some(x=>x?.includes('?')))out.invalid='unsupported_numeric_component';
 if(core.replace(/[-()]/g,''))out.invalid='unsupported_or_ambiguous_component';
 return out;
}
function compareAddresses(oldValue,newValue){
 const a=parseAddress(oldValue),b=parseAddress(newValue);
 const result=(relation,reason,sharedParent=false)=>({relation,reason,sharedParent,old:a,new:b});
 if(a.invalid||b.invalid)return result('unknown',a.invalid||b.invalid);
 const fullStreet=a.street&&a.house&&b.street&&b.house;
 let shared=false;
 if(fullStreet){
  if(a.district&&b.district&&a.district!==b.district)return result('different','different_district');
  if(a.street!==b.street)return result('different','different_street');
  if(a.house!==b.house)return result('different','different_house');
  shared=true;
 }else if(a.site&&b.site&&a.site===b.site&&a.building&&b.building){shared=true;}
 else return result('unknown','incomparable_parent');
 if(a.courtyard!==b.courtyard)return result('unknown','incomparable_courtyard',shared);
 if(a.courtyard&&!a.building&&!b.building&&(a.floor||b.floor||a.unit||b.unit))return result('unknown','missing_courtyard_building',shared);
 if(a.site&&b.site&&a.site!==b.site)return result('unknown','conflicting_site',shared);
 // A shared street+door or an exact named complex establishes the parent,
 // never the entity. Missing higher components stop lower-level comparisons.
 for(const field of ['building','floor','unit']){
  if(!!a[field]!==!!b[field])return result('unknown','missing_'+field,shared);
  if(a[field]&&a[field]!==b[field])return result('different','different_'+field,shared);
 }
 return result('same_address','same_explicit_address',shared);
}
module.exports={parseAddress,compareAddresses};
