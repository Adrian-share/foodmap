'use strict';
const {validScreenshot,videoSource}=require('./catalog.cjs');
// Enrich previously accepted visits without changing their shop identity or admission rules.
function baselineRecords(base,entries){
  const seen=new Set();
  return entries.map(e=>{
    if(seen.has(e.visit_id))throw Error('旧到访截图重复：'+e.visit_id);seen.add(e.visit_id);
    const v=base.visits.find(v=>v.id===e.visit_id),s=base.shops.find(s=>s.id===v?.shop_id);
    if(!v||!s||v.shop_id!==e.store_id||v.verification!=='baseline_accepted'||s.verification!=='verified'||v.video!==videoSource(e.bvid)||e.part!==1||!Number.isFinite(e.duration_seconds)||e.duration_seconds<=0)throw Error('旧到访截图来源未匹配：'+e.visit_id);
    const record={creator:{name:v.creator,uid:v.creator_id},
      video:{bvid:e.bvid,url:v.video,title:v.title,part:e.part,duration_seconds:e.duration_seconds,metadata_status:'baseline_accepted'},
      visit:{id:v.id,store_id:s.id,store_name:s.name,branch_name:s.name,city:s.city,district:s.address.split(' · ')[0],address:s.address,gcj02:{lng:s.lng,lat:s.lat},start_seconds:0,end_seconds:e.duration_seconds,screenshots:[e.screenshot],opinions:[],dishes:[]},
      review:{status:'approved',basis:'沿用已验收的门店与到访关系；本次仅补充对应视频截图'}};
    if(!validScreenshot(record,e.screenshot))throw Error('旧到访截图无效：'+e.visit_id);
    return {id:v.id,shop_id:s.id,record};
  });
}
module.exports={baselineRecords};
