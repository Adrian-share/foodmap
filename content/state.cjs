const {assess,buildCatalog,visitKey,detailUrl,playerUrl}=require('./catalog.cjs');

// A single compiled snapshot supplies both Node and Worker. Never read batches at request time.
function createContentState({batches,config,version},images){
  const assetAvailable=i=>images['/'+i.path]?.sha256===i.sha256;
  const catalog=buildCatalog(batches,assetAvailable,config);
  if(version)catalog.version=version;
  const publishedKeys=new Set(catalog.visits.map(v=>v.id));
  const records=new Map();
  for(const batch of batches){
    if(batch.enabled===false)continue;
    for(const r of batch.records){
      const id=visitKey(r),reasons=assess(r,config);
      if(!reasons.length&&!r.visit.screenshots.every(assetAvailable))reasons.push('截图文件未通过构建校验');
      const existing=records.get(id);
      if(existing){
        if(JSON.stringify(existing.raw)!==JSON.stringify(r))throw Error('到访 ID 冲突：'+id);
        existing.batch_ids.push(batch.batch_id);continue;
      }
      let player=null;
      try{player=playerUrl(r);}catch{}
      records.set(id,{raw:r,batch_ids:[batch.batch_id],value:{
        visit_id:id,detail_url:detailUrl(r),creator:r.creator,video:r.video,visit:r.visit,
        review:r.review,publication_reasons:reasons,player_url:player,published:publishedKeys.has(id)
      }});
    }
  }
  return {catalog,images,version:catalog.version,batches:batches.filter(b=>b.enabled!==false).map(b=>({batch_id:b.batch_id,version:b.version})),
    records:[...records.values()].map(r=>({...r.value,batch_ids:[...new Set(r.batch_ids)].sort()}))};
}
module.exports={createContentState};
