const baseline=require('../data/catalog.json');
const batch=require('./batches/beijing-pilot-001.json');
const assets=require('./public-assets.json');
const {buildCatalog,validScreenshot}=require('./catalog.cjs');
function imageForRecord(record){
  const i=record.visit.screenshots?.find(i=>validScreenshot(record,i)&&assets['/'+i.path]?.sha256===i.sha256);
  return i?{...i,url:'/'+i.path,kind:'video_screenshot'}:null;
}
function homeCatalog(){
  const imported=buildCatalog([batch]);const byId=new Map();
  for(const shop of baseline.shops.filter(s=>s.city==='北京')){
    const visits=baseline.visits.filter(v=>v.shop_id===shop.id);
    byId.set(shop.id,{...shop,video:visits[0]?.video,creator:visits[0]?.creator||null,note:null,image:null,visits});
  }
  for(const shop of imported.shops){
    const visits=imported.visits.filter(v=>v.shop_id===shop.id);
    const primary=visits.find(v=>imageForRecord(v.record))||visits[0];
    const image=imageForRecord(primary.record),note=primary.record.visit.opinions?.[0]||primary.record.visit.dishes?.[0];
    const old=[...byId.values()].find(s=>s.id===shop.id||s.amap_poi_id===shop.amap_poi_id);
    byId.set(old?.id||shop.id,{...old,...shop,id:old?.id||shop.id,video:primary.video,creator:primary.creator,
      note:note?.text||null,note_seconds:note?.seconds??null,image,
      visits:[...(old?.visits||[]),...visits.map(v=>({id:v.id,bvid:v.bvid,video:v.video,creator:v.creator,uid:v.uid,part:v.record.video.part,start_seconds:v.record.visit.start_seconds,end_seconds:v.record.visit.end_seconds}))]});
  }
  return {version:batch.version,baseline_version:baseline.version,shops:[...byId.values()]};
}
module.exports={homeCatalog,imageForRecord};
