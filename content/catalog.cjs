'use strict';
const CREATORS=new Set(['3546888255048212','3546728118618546','544336675']);
const BV=/^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const IMAGE=/^content\/images\/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$/;
const videoSource=bvid=>`https://www.bilibili.com/video/${bvid}/`;
function assess(r){
  const reasons=[],v=r.video||{},s=r.visit||{};
  if(!CREATORS.has(r.creator?.uid)||v.owner_uid!==r.creator?.uid||v.metadata_status!=='verified')reasons.push('作者归属未核准');
  if(!BV.test(v.bvid)||v.url!==videoSource(v.bvid)||!Number.isInteger(v.part)||v.part<1||!v.published_at)reasons.push('原视频信息不完整');
  if(s.city!=='北京市'||!s.branch_name||!s.district||!s.address||!s.store_id||!s.amap_poi_id||s.amap_url!==`https://ditu.amap.com/place/${s.amap_poi_id}`)reasons.push('北京具体分店未核准');
  if(!s.gcj02||!Number.isFinite(s.gcj02.lng)||!Number.isFinite(s.gcj02.lat)||s.gcj02.lng<115.4||s.gcj02.lng>117.6||s.gcj02.lat<39.4||s.gcj02.lat>41.1)reasons.push('GCJ-02 点位未核准');
  if(!s.evidence?.some(e=>e.type==='branch'&&e.status==='verified'&&e.url===v.url&&Number.isFinite(e.seconds))||!s.evidence?.some(e=>e.type==='amap'&&e.status==='verified'&&e.url===s.amap_url))reasons.push('缺少原视频分店及高德对应证据');
  if(['closed','moved'].includes(s.business_status))reasons.push('门店已关闭或迁移');
  if(!Number.isFinite(s.start_seconds)||!Number.isFinite(s.end_seconds)||s.start_seconds<0||s.end_seconds<=s.start_seconds||s.end_seconds>v.duration_seconds)reasons.push('到访片段时间未核准');
  if([...(s.opinions||[]),...(s.dishes||[])].some(x=>!x.text?.trim()||x.source_video!==v.url||!Number.isFinite(x.seconds)||x.seconds<s.start_seconds||x.seconds>s.end_seconds))reasons.push('观点或菜品缺少对应时间点证据');
  if(r.review?.status!=='approved')reasons.push('尚未审核通过');
  return reasons;
}
// 2026-11-11 规格：分店关系核准即可收录，缺图显示待补；图片独立校验来源。
function publicRecords(records){return records.filter(r=>!assess(r).length);}
function validScreenshot(r,i){
  const s=r.visit,v=r.video;
  return IMAGE.test(i.path)&&i.source_video===v.url&&i.part===v.part&&Number.isFinite(i.timestamp_ms)&&i.timestamp_ms>=s.start_seconds*1000&&i.timestamp_ms<=s.end_seconds*1000&&!!i.alt?.trim()&&i.frame_verified===true&&/^[a-f0-9]{64}$/.test(i.sha256||'');
}
function playerUrl(r){
  if(!BV.test(r.video?.bvid)||!Number.isInteger(r.video.part)||r.video.part<1)throw Error('无效原视频');
  const t=r.visit?.start_seconds??0;if(!Number.isFinite(t)||t<0)throw Error('无效时间点');
  return 'https://player.bilibili.com/player.html?'+new URLSearchParams({bvid:r.video.bvid,p:String(r.video.part),t:String(t),autoplay:'0',danmaku:'0'});
}
// 从启用批次重建派生目录；删除/停用批次后重建即可撤回，无累加副作用。
function buildCatalog(batches,assetAvailable){
  const creators=new Map(),videos=new Map(),visits=new Map(),shops=new Map(),versions=new Map();
  for(const batch of batches){
    if(batch.enabled===false)continue;
    versions.set(batch.batch_id,batch.version);
    for(const r of publicRecords(batch.records,assetAvailable)){
      creators.set(r.creator.uid,r.creator);videos.set(r.video.bvid,r.video);
      const s=r.visit,shopId='amap:'+s.amap_poi_id;
      shops.set(shopId,{id:shopId,name:s.store_name+'（'+s.branch_name+'）',city:'北京',district:s.district,address:s.address,...s.gcj02,verification:'verified',source:r.video.url,amap_poi_id:s.amap_poi_id});
      visits.set([r.video.bvid,r.video.part,s.id].join(':'),{id:s.id,shop_id:shopId,bvid:r.video.bvid,video:r.video.url,creator:r.creator.name,uid:r.creator.uid,record:r});
    }
  }
  return {version:[...versions].sort().map(([k,v])=>k+':'+v).join(','),creators:[...creators.values()],videos:[...videos.values()],shops:[...shops.values()],visits:[...visits.values()]};
}
module.exports={assess,publicRecords,validScreenshot,buildCatalog,playerUrl,videoSource,IMAGE};
