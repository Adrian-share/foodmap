const {assess,buildCatalog,visitKey,detailUrl,playerUrl,validScreenshot}=require('./catalog.cjs');

// A single compiled snapshot supplies both Node and Worker. Never read batches at request time.
function createContentState({batches,config,version,baseline_records=[],ledger,store_aliases,identity_projection=false},images){
  if(identity_projection)config={...config,store_aliases:store_aliases||config.store_aliases||{}};
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
  const state={catalog,images,ledger,version:catalog.version,batches:batches.filter(b=>b.enabled!==false).map(b=>({batch_id:b.batch_id,version:b.version})),
    records:[...records.values()].map(r=>({...r.value,batch_ids:[...new Set(r.batch_ids)].sort()}))};
  return identity_projection?projectContentState(state,store_aliases||config.store_aliases||{}):state;
}
function projectContentState(state,aliases){
  const {projectRecord,copy}=require('./store-identity.cjs');
  const projectVisit=v=>{const record=projectRecord(v.record,aliases);return {...v,shop_id:record.visit.store_id,record};};
  const baselineVisits=(state.catalog.baseline_visits||[]).map(projectVisit),visits=state.catalog.visits.map(projectVisit);
  const shops=new Map(baselineVisits.map(v=>{const r=v.record,s=r.visit;return [v.shop_id,{id:v.shop_id,name:s.store_name,city:'北京',district:s.district,address:s.address,lng:s.gcj02.lng,lat:s.gcj02.lat,source:r.video.url,verification:'verified',...(s.amap_poi_id?{amap_poi_id:s.amap_poi_id}:{})}];}));
  for(const shop of state.catalog.shops){const id=Object.hasOwn(aliases,shop.amap_poi_id)?aliases[shop.amap_poi_id]:shop.id;shops.set(id,{...shop,id});}
  const records=state.records.map(r=>projectRecord(r,aliases));
  const byVisit=new Map(records.map(r=>[r.visit_id,r]));
  let ledger=state.ledger;
  if(ledger){
    const videos=ledger.videos.map(v=>({...v,visits:v.visits.map(x=>{const id=byVisit.get(x.visit_id)?.visit.store_id||x.store_id;return {...x,store_id:id,map_url:'/?'+new URLSearchParams({store_id:id,creator:v.creator_uid,data_version:state.data_version||state.version})};})}));
    const byBvid=new Map(videos.map(v=>[v.bvid,v]));
    ledger={...ledger,videos,creators:ledger.creators.map(c=>({...c,counts:{...c.counts,searchable_stores:new Set(videos.filter(v=>v.creator_uid===c.uid).flatMap(v=>v.visits.filter(x=>x.published).map(x=>x.store_id))).size},...(c.latest_published?{latest_published:byBvid.get(c.latest_published.bvid)}:{}),...(c.latest_discovered?{latest_discovered:byBvid.get(c.latest_discovered.bvid)}:{})}))};
  }
  return {...state,records,ledger,store_aliases:copy(aliases),catalog:{...state.catalog,shops:[...shops.values()],visits,baseline_visits:baselineVisits,store_aliases:copy(aliases),identity_projection:true,complete:true}};
}
module.exports={createContentState,projectContentState};
