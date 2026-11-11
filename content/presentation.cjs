const assets=require('./public-assets.json');
const {playerUrl}=require('./catalog.cjs');

function withContentCard(shop,baseUrl,images=assets){
  // All card fields come from the same visit; never select its image separately.
  const visit=shop.visits?.find(v=>v.record?.visit.screenshots.some(i=>images['/'+i.path]?.sha256===i.sha256));
  if(!visit)return shop;
  const r=visit.record,screenshot=r.visit.screenshots.find(i=>images['/'+i.path]?.sha256===i.sha256);
  const image={url:new URL('/'+screenshot.path,baseUrl).href,source:screenshot.source_video,
    alt:screenshot.alt,kind:'video_screenshot',timestamp_ms:screenshot.timestamp_ms,part:screenshot.part,
    usage_basis:screenshot.usage_basis,mime_type:images['/'+screenshot.path].type,sha256:screenshot.sha256};
  const description=r.visit.opinions?.[0]||r.visit.dishes?.[0]||null;
  const card={visit_id:visit.id,store_id:shop.id,creator:r.creator,description,image,
    detail_url:visit.detail_url,player_url:playerUrl(r),video:r.video};
  return {...shop,source:visit.video,video:visit.video,featured_visit_id:visit.id,detail_url:visit.detail_url,image,card};
}
module.exports={withContentCard};
