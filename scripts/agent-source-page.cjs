'use strict';
// A structured stdin adapter. Source values can never become argv or executable code.
const {resolveFetch,fetchJson}=require('./refresh-creator-inventory-incremental.cjs');
const approvedAnchors=require('../content/source-anchors.json');
const digest=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sourceError(code,result){return Object.assign(Error(code),{error_code:code,...(result?{http_status:result.http_status,business_code:result.code,url:result.url}:{})});}
async function sourcePage({source,page},fetchImpl=resolveFetch()){
 if(!source||!['posts','season','view'].includes(source.type)||!Number.isSafeInteger(page)||page<1||page>10000||!/^\d{1,20}$/.test(source.uid))throw Error('invalid_source');
 const size=30;let url;
 if(source.type==='posts')url='https://api.bilibili.com/x/space/wbi/arc/search?'+new URLSearchParams({mid:source.uid,pn:page,ps:size,order:'pubdate'});
 if(source.type==='season'){
  if(!/^[1-9][0-9]{0,19}$/.test(source.id))throw Error('invalid_season');
  url='https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?'+new URLSearchParams({mid:source.uid,season_id:source.id,sort_reverse:false,page_num:page,page_size:size});
  if(source.anchor_bvid){
   if(!approvedAnchors.some(a=>a.uid===source.uid&&a.season_id===source.id&&a.bvid===source.anchor_bvid))throw sourceError('unapproved_collection_anchor');
   url='https://api.bilibili.com/x/web-interface/view?'+new URLSearchParams({bvid:source.anchor_bvid});
  }
 }
 if(source.type==='view'){
  if(!/^BV[1-9A-HJ-NP-Za-km-z]{10}$/.test(source.id))throw Error('invalid_bvid');
  url='https://api.bilibili.com/x/web-interface/view?'+new URLSearchParams({bvid:source.id});
 }
 const result=await fetchJson(fetchImpl,url);
 if(result.http_status!==200||result.code!==0)throw sourceError('official_source_restricted',result);
 const data=result.data.data;
 if(source.type==='season'&&source.anchor_bvid){
  const season=data?.ugc_season;
  if(data?.bvid!==source.anchor_bvid||String(data?.owner?.mid)!==source.uid||String(season?.id)!==source.id||String(season?.mid)!==source.uid)throw sourceError('official_collection_identity_conflict',result);
  if(!Array.isArray(season.sections)||season.sections.length>1000||season.sections.some(s=>!Array.isArray(s.episodes)))throw sourceError('invalid_collection_list',result);
  const episodes=season.sections.flatMap(s=>s.episodes);
  if(!Number.isSafeInteger(season.ep_count)||season.ep_count<1||season.ep_count!==episodes.length||episodes.length>10000)throw sourceError('incomplete_collection_list',result);
  if(episodes.some(e=>!/^BV[1-9A-HJ-NP-Za-km-z]{10}$/.test(e.bvid)||String(e.arc?.author?.mid)!==source.uid))throw sourceError('official_collection_identity_conflict',result);
  const pageSize=100,offset=(page-1)*pageSize;if(offset>=episodes.length)throw sourceError('invalid_collection_page',result);
  return {url,http_status:result.http_status,business_code:result.code,reached_end:offset+pageSize>=episodes.length,
   items:episodes.slice(offset,offset+pageSize).map(e=>({bvid:e.bvid,uid:String(e.arc.author.mid),title:e.arc.title})),
   collection:{id:source.id,uid:source.uid,anchor_bvid:source.anchor_bvid,reported_total:season.ep_count,read_count:episodes.length,page,page_size:pageSize,payload_sha256:digest(result.data)}};
 }
 if(source.type==='view')return {url,reached_end:true,items:[{bvid:data.bvid,uid:String(data.owner?.mid),title:data.title}]};
 const list=source.type==='posts'?data.list?.vlist:data.archives;
 if(!Array.isArray(list)||list.length>size)throw Error('invalid_source_list');
 const total=source.type==='posts'?data.page?.count:data.meta?.total;
 return {url,reached_end:list.length<size||(Number.isSafeInteger(total)&&page*size>=total),items:list.map(v=>({bvid:v.bvid,uid:v.mid!=null?String(v.mid):v.owner?.mid!=null?String(v.owner.mid):null,title:v.title}))};
}
if(require.main===module){let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{raw+=c;if(Buffer.byteLength(raw)>8192)process.exit(1);});process.stdin.on('end',async()=>{try{console.log(JSON.stringify(await sourcePage(JSON.parse(raw))));}catch(e){console.log(JSON.stringify({error_code:e.error_code||'official_source_unavailable',...(Number.isInteger(e.http_status)?{http_status:e.http_status}:{}),...(Number.isInteger(e.business_code)?{business_code:e.business_code}:{}),...(e.url?{url:e.url}:{})}));process.exitCode=1;}});}
module.exports={sourcePage};
