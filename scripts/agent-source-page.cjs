'use strict';
// A structured stdin adapter. Source values can never become argv or executable code.
const {resolveFetch,fetchJson}=require('./refresh-creator-inventory-incremental.cjs');
async function sourcePage({source,page},fetchImpl=resolveFetch()){
 if(!source||!['posts','season','view'].includes(source.type)||!Number.isSafeInteger(page)||page<1||page>10000||!/^\d{1,20}$/.test(source.uid))throw Error('invalid_source');
 const size=30;let url;
 if(source.type==='posts')url='https://api.bilibili.com/x/space/wbi/arc/search?'+new URLSearchParams({mid:source.uid,pn:page,ps:size,order:'pubdate'});
 if(source.type==='season'){
  if(!/^[1-9][0-9]{0,19}$/.test(source.id))throw Error('invalid_season');
  url='https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?'+new URLSearchParams({mid:source.uid,season_id:source.id,sort_reverse:false,page_num:page,page_size:size});
 }
 if(source.type==='view'){
  if(!/^BV[1-9A-HJ-NP-Za-km-z]{10}$/.test(source.id))throw Error('invalid_bvid');
  url='https://api.bilibili.com/x/web-interface/view?'+new URLSearchParams({bvid:source.id});
 }
 const result=await fetchJson(fetchImpl,url);
 if(result.http_status!==200||result.code!==0)throw Error('official_source_restricted');
 const data=result.data.data;
 if(source.type==='view')return {url,reached_end:true,items:[{bvid:data.bvid,uid:String(data.owner?.mid),title:data.title}]};
 const list=source.type==='posts'?data.list?.vlist:data.archives;
 if(!Array.isArray(list)||list.length>size)throw Error('invalid_source_list');
 const total=source.type==='posts'?data.page?.count:data.meta?.total;
 return {url,reached_end:list.length<size||(Number.isSafeInteger(total)&&page*size>=total),items:list.map(v=>({bvid:v.bvid,uid:v.mid!=null?String(v.mid):v.owner?.mid!=null?String(v.owner.mid):null,title:v.title}))};
}
if(require.main===module){let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{raw+=c;if(Buffer.byteLength(raw)>8192)process.exit(1);});process.stdin.on('end',async()=>{try{console.log(JSON.stringify(await sourcePage(JSON.parse(raw))));}catch{console.log(JSON.stringify({error_code:'official_source_unavailable'}));process.exitCode=1;}});}
module.exports={sourcePage};
