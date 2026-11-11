const assets=require('./public-assets.json');
const {playerUrl,validScreenshot}=require('./catalog.cjs');
function imageForRecord(record,images=assets){
  const i=record.visit.screenshots?.find(i=>validScreenshot(record,i)&&images['/'+i.path]?.sha256===i.sha256);
  return i?{...i,url:'/'+i.path,kind:'video_screenshot'}:null;
}
function withContentCard(shop,baseUrl,images=assets){
  // Select the visit once so image, attribution, description and playback cannot drift.
  const visits=shop.visits?.filter(v=>v.record)||[];
  const visit=visits.find(v=>imageForRecord(v.record,images))||visits[0];
  if(!visit)return shop;
  const r=visit.record,screenshot=imageForRecord(r,images);
  const image=screenshot?{...screenshot,url:new URL(screenshot.url,baseUrl).href,source:screenshot.source_video,mime_type:images[screenshot.url].type}:null;
  const description=r.visit.opinions?.[0]||r.visit.dishes?.[0]||null;
  const card={visit_id:visit.id,store_id:shop.id,creator:r.creator,description,image,
    detail_url:visit.detail_url,player_url:playerUrl(r),video:r.video};
  return {...shop,source:visit.video,video:visit.video,featured_visit_id:visit.id,detail_url:visit.detail_url,image,card,
    creator:r.creator.name,note:description?.text||null,note_seconds:description?.seconds??null};
}
module.exports={withContentCard,imageForRecord};
