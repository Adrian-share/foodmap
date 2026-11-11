const {assess,buildCatalog,visitKey,detailUrl,playerUrl,validScreenshot}=require('./catalog.cjs');

// A single compiled snapshot supplies both Node and Worker. Never read batches at request time.
function createContentState({batches,config,version,baseline_records=[]},images){
  const assetAvailable=i=>images['/'+i.path]?.sha256===i.sha256;
  const catalog=buildCatalog(batches,assetAvailable,config);
  if(version)catalog.version=version;
  const publishedKeys=new Set(catalog.visits.map(v=>v.id));
  const records=new Map();
  catalog.baseline_visits=baseline_records.map(({id,shop_id,record:r})=>({id,shop_id,video:r.video.url,bvid:r.video.bvid,creator:r.creator.name,uid:r.creator.uid,record:r,detail_url:'/content/?visit_id='+encodeURIComponent(id)}));
  for(const v of catalog.baseline_visits){
    const r=v.record,screenshots=r.visit.screenshots.filter(i=>validScreenshot(r,i)&&assetAvailable(i));
    records.set(v.id,{raw:r,batch_ids:[],value:{visit_id:v.id,detail_url:v.detail_url,creator:r.creator,video:r.video,visit:{...r.visit,screenshots},image_status:screenshots.length?'available':'missing',review:r.review,publication_reasons:[],player_url:playerUrl(r),published:true}});
  }
  for(const batch of batches){
    if(batch.enabled===false)continue;
    for(const r of batch.records){
      const id=visitKey(r),reasons=assess(r,config);
      const screenshots=(r.visit.screenshots||[]).filter(i=>validScreenshot(r,i)&&assetAvailable(i));
      const existing=records.get(id);
      if(existing){
        if(JSON.stringify(existing.raw)!==JSON.stringify(r))throw Error('到访 ID 冲突：'+id);
        existing.batch_ids.push(batch.batch_id);continue;
      }
      let player=null;
      try{player=playerUrl(r);}catch{}
      records.set(id,{raw:r,batch_ids:[batch.batch_id],value:{
        visit_id:id,detail_url:detailUrl(r),creator:r.creator,video:r.video,visit:{...r.visit,screenshots},image_status:screenshots.length?'available':'missing',
        review:r.review,publication_reasons:reasons,player_url:player,published:publishedKeys.has(id)
      }});
    }
  }
  return {catalog,images,version:catalog.version,batches:batches.filter(b=>b.enabled!==false).map(b=>({batch_id:b.batch_id,version:b.version})),
    records:[...records.values()].map(r=>({...r.value,batch_ids:[...new Set(r.batch_ids)].sort()}))};
}
module.exports={createContentState};
