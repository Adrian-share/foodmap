// fixture=true, isolated synthetic evidence only. Never upload these POIs.
const assert=require('node:assert/strict');
const {input,sha,png}=require('./publication.cjs');
const {verifyExtraction}=require('../../content/verification.cjs');
const frozen=require('../../content/compiled.json'),assets=require('../../content/public-assets.json'),base=require('../../data/catalog.json');
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
function proof(poi='OFFLINE_TAIFENG',overrides={}){
 const s=base.shops.find(x=>x.id==='beijing-1'),p={id:poi,name:'泰丰楼(前门店)',address:'前门西大街2号楼',cityname:'北京市',adname:'西城区',location:s.lng+','+s.lat,typecode:'050100',...overrides};
 const raw=Buffer.from(JSON.stringify({status:'1',pois:[p]}));
 return {poi_id:poi,store_id:s.id,baseline_sha256:sha(JSON.stringify(canonical(s))),checked_at:'2026-11-20T04:00:00Z',source_url:'https://restapi.amap.com/v5/place/text?keywords='+encodeURIComponent('泰丰楼')+'&region=110000',retrieved_via:'https://foodmap.shareworld.fun/api/content/poi?q='+encodeURIComponent('泰丰楼'),response_sha256:sha(raw),response_base64:raw.toString('base64')};
}
async function visit({poi='OFFLINE_TAIFENG',bvid='BV1abcde2345',uid='544336675',description='这道菜口感很好',storeName='泰丰楼',branchName='前门店',address='前门西大街2号楼',district='西城区',gcj02={lng:116.391816,lat:39.899823},poiName,poiType='050100',officialDescription=false}={}){
 const x=input(),raw=png(bvid==='BV1abcde2345'?50:80),imageHash=sha(raw);x.identity.bvid=bvid;x.identity.creator_uid=uid;x.proposal.bvid=bvid;x.proposal.creator_uid=uid;
 for(const s of x.sources){if(s.kind==='metadata'){s.source_url='https://api.bilibili.com/x/web-interface/view?bvid='+bvid;s.payload.data.bvid=bvid;s.payload.data.owner.mid=uid;if(officialDescription)s.payload.data.desc=storeName+branchName+'，'+district+address+'。'+description+'。';}if(s.kind==='subtitle'){s.payload.bvid=bvid;s.payload.body[0].content=storeName+branchName+'，'+district+address+'。'+description+'。';}if(s.kind==='poi')s.payload=JSON.parse(Buffer.from(proof(poi,{name:poiName||storeName+'('+branchName+')',address,adname:district,location:gcj02.lng+','+gcj02.lat,typecode:poiType}).response_base64,'base64'));if(s.kind==='frame'){Object.assign(s.payload,{bvid,sha256:imageHash,bytes:raw.length});s.source_url='https://www.bilibili.com/video/'+bvid+'/';}s.sha256=sha(JSON.stringify(s.payload));}
 Object.assign(x.proposal.visits[0],{description,store_name:storeName,branch_name:branchName,address_hint:address,poi_candidates:[poi]});
 if(officialDescription){x.sources=x.sources.filter(s=>s.kind!=='subtitle');x.proposal.evidence_ids=x.proposal.evidence_ids.filter(e=>e!=='subtitle');x.proposal.visits[0].evidence_ids=x.proposal.visits[0].evidence_ids.filter(e=>e!=='subtitle');}
 const result=await verifyExtraction(x);assert.equal(result.status,'approved');return {x,result,images:{...assets,['/content/images/'+imageHash+'.png']:{sha256:imageHash,type:'image/png',base64:raw.toString('base64')}},raw};
}
const manifest=(records=[],aliases,proofs)=>({schema_version:1,baseline_version:frozen.version,source_commit:'a'.repeat(40),rules_version:records.some(r=>r.review.rules_version==='v2')?'v2':'v1',parent_version:null,watchlist_revision:1,records,images:[],verification_ids:records.map(r=>r.review.verification_id),...(aliases===undefined?{}:{store_aliases:aliases,store_alias_evidence:proofs})});
async function stored(bucket,m){const raw=JSON.stringify(m),v='v1-'+sha(raw);await bucket.put('public/releases/'+v+'.json',raw);return v;}
module.exports={visit,proof,manifest,stored};
