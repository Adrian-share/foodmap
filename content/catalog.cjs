'use strict';
const config=require('./config.json');
const BV=/^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const IMAGE=/^content\/images\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;
const videoSource=bvid=>`https://www.bilibili.com/video/${bvid}/`;
function assess(r,options=config){
  const reasons=[],v=r.video||{},s=r.visit||{};
  if(!options.creator_uids.includes(r.creator?.uid)||v.owner_uid!==r.creator?.uid||v.metadata_status!=='verified'||!r.creator?.name?.trim())reasons.push('作者归属未核准');
  if(!/^[A-Za-z0-9_-]+$/.test(s.id||''))reasons.push('缺少稳定的到访 ID');
  if(!BV.test(v.bvid)||v.url!==videoSource(v.bvid)||!Number.isInteger(v.part)||v.part<1||!v.published_at)reasons.push('原视频信息不完整');
  if(s.city!=='北京市'||!s.branch_name||!s.district||!s.address||!s.store_id||!s.amap_poi_id||s.amap_url!==`https://ditu.amap.com/place/${s.amap_poi_id}`)reasons.push('北京具体分店未核准');
  if(!s.gcj02||!Number.isFinite(s.gcj02.lng)||!Number.isFinite(s.gcj02.lat)||s.gcj02.lng<115.4||s.gcj02.lng>117.6||s.gcj02.lat<39.4||s.gcj02.lat>41.1)reasons.push('GCJ-02 点位未核准');
  if(!s.evidence?.some(e=>e.type==='branch'&&e.status==='verified'&&e.url===v.url&&Number.isFinite(e.seconds))||!s.evidence?.some(e=>e.type==='amap'&&e.status==='verified'&&e.url===s.amap_url))reasons.push('缺少原视频分店及高德对应证据');
  if(s.business_status!=='open')reasons.push('当前营业状态待核或已关闭');
  if(!Number.isFinite(v.duration_seconds)||!Number.isFinite(s.start_seconds)||!Number.isFinite(s.end_seconds)||s.start_seconds<0||s.end_seconds<=s.start_seconds||s.end_seconds>v.duration_seconds)reasons.push('到访片段时间未核准');
  if([...(s.opinions||[]),...(s.dishes||[])].some(x=>!x.text?.trim()||x.source_video!==v.url||!Number.isFinite(x.seconds)||x.seconds<s.start_seconds||x.seconds>s.end_seconds))reasons.push('观点或菜品缺少对应时间点证据');
  const images=s.screenshots||[];
  if(!images.length||images.some(i=>!IMAGE.test(i.path)||i.source_video!==v.url||i.part!==v.part||!Number.isFinite(i.timestamp_ms)||i.timestamp_ms<s.start_seconds*1000||i.timestamp_ms>s.end_seconds*1000||!i.alt?.trim()||!i.usage_basis?.trim()||i.rights_status!=='approved'||i.frame_verified!==true||! /^[a-f0-9]{64}$/.test(i.sha256||'')))reasons.push('待补对应片段的真实截图及使用依据');
  if(r.review?.status!=='approved')reasons.push('尚未审核通过');
  return reasons;
}
function publicRecords(records,assetAvailable=()=>false,options=config){return records.filter(r=>!assess(r,options).length&&r.visit.screenshots.every(assetAvailable));}
const visitKey=r=>[r.video.bvid,r.video.part,r.visit.id].join(':');
const detailUrl=r=>'/content/?visit_id='+encodeURIComponent(visitKey(r));
function playerUrl(r){
  if(!BV.test(r.video?.bvid)||!Number.isInteger(r.video.part)||r.video.part<1)throw Error('无效原视频');
  const t=r.visit?.start_seconds??0;if(!Number.isFinite(t)||t<0)throw Error('无效时间点');
  return 'https://player.bilibili.com/player.html?'+new URLSearchParams({bvid:r.video.bvid,p:String(r.video.part),t:String(t),autoplay:'0',danmaku:'0'});
}
// 从启用批次重建派生目录；删除/停用批次后重建即可撤回，无累加副作用。
function buildCatalog(batches,assetAvailable,options=config){
  const creators=new Map(),videos=new Map(),visits=new Map(),shops=new Map(),versions=new Map();
  const seenBatches=new Map();
  for(const batch of [...batches].sort((a,b)=>a.batch_id.localeCompare(b.batch_id))){
    if(batch.enabled===false)continue;
    const signature=JSON.stringify(batch);
    if(seenBatches.has(batch.batch_id)){
      if(seenBatches.get(batch.batch_id)!==signature)throw Error('批次 ID 冲突：'+batch.batch_id);
      continue;
    }
    seenBatches.set(batch.batch_id,signature);
    versions.set(batch.batch_id,batch.version);
    for(const r of publicRecords(batch.records,assetAvailable,options)){
      creators.set(r.creator.uid,r.creator);videos.set(r.video.bvid,r.video);
      const s=r.visit,shopId=options.store_aliases?.[s.amap_poi_id]||'amap:'+s.amap_poi_id;
      const previous=shops.get(shopId);
      if(previous&&(previous.amap_poi_id!==s.amap_poi_id||previous.lng!==s.gcj02.lng||previous.lat!==s.gcj02.lat||previous.address!==s.address))throw Error('分店资料冲突：'+shopId);
      shops.set(shopId,{id:shopId,name:s.store_name+'（'+s.branch_name+'）',city:'北京',district:s.district,address:s.address,...s.gcj02,verification:'verified',source:r.video.url,amap_poi_id:s.amap_poi_id});
      const key=visitKey(r),previousVisit=visits.get(key);
      if(previousVisit&&JSON.stringify(previousVisit.record)!==JSON.stringify(r))throw Error('到访 ID 冲突：'+key);
      visits.set(key,{id:key,local_id:s.id,shop_id:shopId,bvid:r.video.bvid,video:r.video.url,creator:r.creator.name,uid:r.creator.uid,record:r,detail_url:detailUrl(r)});
    }
  }
  return {version:[...versions].sort().map(([k,v])=>k+':'+v).join(','),creators:[...creators.values()],videos:[...videos.values()],shops:[...shops.values()],visits:[...visits.values()]};
}
module.exports={assess,publicRecords,buildCatalog,playerUrl,videoSource,visitKey,detailUrl,IMAGE};
