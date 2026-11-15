// Read public official endpoints once per source; failed access remains explicit coverage.
const fs=require("node:fs");const {fetch,ProxyAgent}=require("undici");
const seed=require("../content/inventory/video-inventory-2026-11-12.json");
const dispatcher=process.env.HTTPS_PROXY?new ProxyAgent(process.env.HTTPS_PROXY):undefined;
const checked_at=new Date().toISOString();const out={checked_at,accounts:[],videos:[],discoveries:[],seasons:[]};
const inventoryFile="content/inventory/access-2026-11-15.json";
const attemptDir="content/sources/admin/attempts/"+checked_at.replace(/[:.]/g,'-');
// Never overwrite evidence referenced by an approved batch, even on access failure.
async function read(url,file){try{const r=await fetch(url,{dispatcher,signal:AbortSignal.timeout(15000)});const body=await r.text();fs.writeFileSync(attemptDir+"/"+file,body);let data;try{data=JSON.parse(body)}catch{}return {http_status:r.status,code:data?.code,data,source_file:attemptDir+"/"+file,checked_at,url};}catch(e){return{url,checked_at,error:e.name+":"+e.message}}}
function mergeDiscoveryEvidence(previous,current){
 const discoveries=new Map();
 for(const v of [...(previous.discoveries||[]),...(current.discoveries||[])]){
  const key=[v.creator_uid,v.bvid,v.source].join(':');const old=discoveries.get(key);
  discoveries.set(key,{...old,...v,discovered_at:old?.discovered_at||v.discovered_at});
 }
 const seasons=new Map([...(previous.seasons||[]),...(current.seasons||[])].map(s=>[s.id,s]));
 return {...current,discoveries:[...discoveries.values()],seasons:[...seasons.values()]};
}
async function refresh(){
 fs.mkdirSync(attemptDir,{recursive:true});
 const previous=fs.existsSync(inventoryFile)?JSON.parse(fs.readFileSync(inventoryFile,'utf8')):{};
 const ledger=require('../content/runtime.cjs').ledger;
 const creators=[...new Map([...seed.creators,...(ledger?.creators||[])].map(c=>[c.uid,c])).values()];
 for(const c of creators){
  const r=await read(`https://api.bilibili.com/x/space/wbi/arc/search?mid=${c.uid}&pn=1&ps=30&order=pubdate`,c.uid+"-page-1.json");
  out.accounts.push({uid:c.uid,...r,data:undefined,scope:"公开投稿列表第1页",last_page:1,reached_end:false,restriction:r.data?.code===0?"仅访问第1页，不代表历史穷尽":`入口受限：HTTP ${r.http_status||"无响应"} / code ${r.code??r.error??"非JSON"}`,next_step:"提供可访问的官方投稿导出/官方合集或北京原视频链接，核对分店后走批次审核。"});
  if(r.code===0)for(const v of r.data?.data?.list?.vlist||[])out.discoveries.push({bvid:v.bvid,creator_uid:c.uid,title:v.title,published_at:new Date(v.created*1000).toISOString(),discovered_at:checked_at,owner_verified:String(v.mid)===c.uid,source:r.url});
  console.log("account",c.uid,r.http_status,r.code);
 }
 const candidates=[...new Map([...seed.videos.filter(v=>v.sources.includes("candidate_samples")||v.status==="已公开"||["BV1NG6kYTEXG","BV1gkxKefEfW","BV1k1KN6BEvw"].includes(v.bvid)),...(ledger?.videos||[]).filter(v=>v.status==='published'||!v.sources.includes('multica_inventory'))].map(v=>[v.bvid,v])).values()];
 for(const v of candidates){const r=await read("https://api.bilibili.com/x/web-interface/view?bvid="+v.bvid,v.bvid+".json");const d=r.data?.data;
 out.videos.push({bvid:v.bvid,checked_at,url:r.url,http_status:r.http_status,code:r.code,error:r.error,owner_uid:d?String(d.owner.mid):null,title:d?.title,description:d?.desc,published_at:d?new Date(d.pubdate*1000).toISOString():null,duration_seconds:d?.duration,season_id:d?.season_id});
 const s=d?.ugc_season;if(s?.id===5780378&&!out.seasons.some(x=>x.id===s.id)){
  const episodes=s.sections.flatMap(s=>s.episodes);out.seasons.push({id:s.id,uid:String(s.mid),title:s.title,total:s.ep_count,obtained:episodes.length,reached_end:episodes.length===s.ep_count,last_bvid:episodes.at(-1)?.bvid,source:r.url,checked_at});
  for(const e of episodes)out.discoveries.push({bvid:e.bvid,creator_uid:String(s.mid),title:e.arc.title,published_at:new Date(e.arc.pubdate*1000).toISOString(),discovered_at:checked_at,owner_verified:String(e.arc.author.mid)===String(s.mid),source:r.url+'#season-'+s.id});
 }
 console.log("video",v.bvid,r.http_status,r.code);}
 const merged=mergeDiscoveryEvidence(previous,out);
 fs.writeFileSync(inventoryFile+'.tmp',JSON.stringify(merged,null,2)+"\n");fs.renameSync(inventoryFile+'.tmp',inventoryFile);
 await dispatcher?.close();
}
if(require.main===module)refresh().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={mergeDiscoveryEvidence};
