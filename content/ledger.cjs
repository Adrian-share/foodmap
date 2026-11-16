'use strict';
// The ledger is derived from source evidence and the current release, never snapshot counts.
const sortVideos=(a,b)=>(Date.parse(b.bilibili_published_at)||0)-(Date.parse(a.bilibili_published_at)||0)||a.bvid.localeCompare(b.bvid);
function buildLedger({snapshot,records=[],access={},historical={},accounts=[],samples=[]}){
  const asOf=access.checked_at||snapshot.as_of+'T00:00:00+08:00';
  const creators=new Map(),videos=new Map();
  function creator(c){
    const uid=String(c.uid||'');if(!/^\d+$/.test(uid))throw Error('台账 UID 无效');
    if(!creators.has(uid))creators.set(uid,{uid,name:c.name,profile_url:c.profile_url||`https://space.bilibili.com/${uid}`,selection_status:c.selection_status||'candidate',sources:[],coverage:{scope:'账号名单和已提供样例',stop:'尚未取得投稿清单',checked_at:asOf,status:'pending',restriction:'账号历史待盘点',next_step:'提供官方投稿/合集或北京原视频链接'}});
    return creators.get(uid);
  }
  function video(bvid,uid,source,values={}){
    if(!/^BV[0-9A-Za-z]{10}$/.test(bvid))throw Error('台账 BV 无效');
    if(!creators.has(uid))throw Error('视频缺少账号：'+uid);
    if(!videos.has(bvid))videos.set(bvid,{bvid,creator_uid:uid,url:`https://www.bilibili.com/video/${bvid}/`,title:bvid,bilibili_published_at:null,date_source:null,discovered_at:snapshot.as_of+'T00:00:00+08:00',discovery_time_precision:'snapshot_day',included_at:null,sources:[],visits:[],status:'pending',missing:[]});
    const v=videos.get(bvid);if(v.creator_uid!==uid)throw Error('视频作者冲突：'+bvid);
    Object.assign(v,values);v.sources.push(source);return v;
  }
  for(const c of snapshot.creators){const x=creator(c);x.sources.push('snapshot:2026-11-12');x.coverage={scope:c.discovery_scope,stop:c.latest_known_bvid||'来源入口',checked_at:snapshot.as_of,account_history_complete:false,status:'pending',restriction:'仅已提供线索，尚未取得账号完整历史',next_step:'补充官方投稿/合集清单与分店证据'};}
  for(const c of accounts){if(!c.uid)continue;const x=creator(c);x.sources.push('creator-list:5d996faa');if(c.related_creator_id)x.relationship_note=c.notes||'名单建议关联，尚未核准账号归属；独立 UID 保留。';}
  for(const v of snapshot.videos){video(v.bvid,v.creator_uid,'snapshot:2026-11-12',{title:v.label||v.bvid,bilibili_published_at:v.bilibili_published_on||null,date_source:v.date_source||null,missing:[v.review_reason||'实际北京分店、POI、点位、片段与截图待核'],historical_status:v.status}).sources.push(...(v.sources||[]));}
  for(const v of historical.records||[]){const x=video(v.bvid,v.creator_uid,'inventory:2026-11-11');x.title=v.title||x.title;x.bilibili_published_at=v.published_at||x.bilibili_published_at;x.date_source='官方视频盘点 2026-11-11';}
  for(const s of samples){const c=accounts.find(c=>c.creator_id===s.creator_id);if(c?.uid)video(s.video_id,c.uid,'candidate-samples:5d996faa');}
  // Register release creators before discoveries; they may be absent from the frozen seed.
  for(const r of records){if(!r.visit.city||r.visit.city.replace(/市$/,'')==='北京')creator(r.creator);}
  for(const d of access.discoveries||[]){
    if(!creators.has(d.creator_uid)||d.owner_verified!==true)continue;
    const known=videos.has(d.bvid),v=video(d.bvid,d.creator_uid,d.source);
    v.title=d.title||v.title;v.bilibili_published_at=d.published_at||v.bilibili_published_at;
    if(!known){v.discovered_at=d.discovered_at||asOf;v.discovery_time_precision='recorded';v.missing=['北京合集/投稿为线索；实际北京分店、POI、片段及截图待核'];}
    else if(d.discovered_at&&Date.parse(d.discovered_at)<Date.parse(v.discovered_at)){v.discovered_at=d.discovered_at;v.discovery_time_precision='recorded';}
  }
  for(const v of access.videos||[]){if(v.code!==0||!v.owner_uid)continue;let x=videos.get(v.bvid);if(!x)continue;
    x.title=v.title||x.title;x.bilibili_published_at=v.published_at||x.bilibili_published_at;x.date_source=v.url;x.sources.push(v.url);
    if(v.error){try{const p=JSON.parse(v.error);if(p.schema_version===1&&p.kind==='pipeline_status'&&['discovered','cleaning','verifying','pending','staged','published','blocked_model','blocked_capture','deferred_budget','failed'].includes(p.stage))x.pipeline_status={stage:p.stage,result:p.result,missing:Array.isArray(p.missing)?p.missing:[],data_version:p.data_version,error_code:p.error_code};}catch{}}
    if(x.creator_uid!==v.owner_uid)x.identity_warning=`当前官方 owner UID ${v.owner_uid} 与历史 UID ${x.creator_uid} 不一致，待复核`;
  }
  for(const r of records){
    if(r.visit.city&&r.visit.city.replace(/市$/,'')!=='北京')continue;
    const uid=String(r.creator.uid),c=creator(r.creator);c.sources.push('current-release');
    const v=video(r.video.bvid,uid,'current-release');v.title=r.video.title||v.title;
    v.bilibili_published_at=r.video.published_at||v.bilibili_published_at;
    v.included_at=r.video.included_at||v.included_at;
    const s=r.visit,storeId=s.store_id;
    if(!v.visits.some(x=>x.visit_id===r.visit_id))v.visits.push({visit_id:r.visit_id,store_id:storeId,store_name:s.store_name,branch_name:s.branch_name,address:s.address,amap_poi_id:s.amap_poi_id||null,gcj02:s.gcj02,part:r.video.part,start_seconds:s.start_seconds,end_seconds:s.end_seconds,published:r.published,review_status:r.review.status,missing:r.publication_reasons||[],screenshots:s.screenshots||[],opinions:s.opinions||[],detail_url:r.detail_url,player_url:r.player_url,map_url:'/?'+new URLSearchParams({store_id:storeId||'',creator:uid}),batch_ids:r.batch_ids||[]});
  }
  for(const v of videos.values()){
    v.sources=[...new Set(v.sources)].sort();
    const published=v.visits.filter(v=>v.published);
    v.status=published.length?'published':v.visits.length&&v.visits.every(v=>v.review_status==='excluded')?'excluded':'pending';
    v.missing=v.status==='published'?[]:[...new Set(v.visits.length?v.visits.flatMap(v=>v.missing):v.missing)];
    if(v.status==='pending'&&v.pipeline_status){v.missing=v.pipeline_status.missing.length?v.pipeline_status.missing:[v.pipeline_status.error_code||v.pipeline_status.stage];if(v.pipeline_status.result==='excluded')v.status='excluded';}
    if(v.status==='pending'&&!v.missing.length)v.missing=['实际北京分店、POI、点位、片段和原视频截图待核'];
    if(v.status==='excluded')v.missing=['审核排除；保留原视频线索及审核记录'];
  }
  for(const c of creators.values()){
    const prev=(historical.creators||[]).find(x=>x.uid===c.uid),a=(access.accounts||[]).find(x=>x.uid===c.uid);
    if(prev)c.coverage={...c.coverage,scope:prev.scope,stop:prev.last_bvid,last_success_at:historical.checked_at,reached_source_end:prev.reached_list_end,source_total:prev.discovered};
    if(a){
      c.coverage={...c.coverage,checked_at:a.checked_at,status:a.code===0?'partial':'restricted',restriction:a.restriction,next_step:a.next_step,last_attempt_url:a.url,last_attempt_page:a.last_page};
      if(a.last_success_range){const range=a.last_success_range;c.coverage={...c.coverage,last_success_at:a.last_success_at,last_success_range:range,scope:range.scope||c.coverage.scope,stop:range.last_bvid||`投稿第${range.last_page||1}页`,reached_source_end:range.reached_end,source_total:range.obtained};}
    }
    const seasons=(access.seasons||[]).filter(s=>s.uid===c.uid);
    if(seasons.length)c.coverage={...c.coverage,ranges:seasons,scope:seasons.map(s=>`官方${s.title}合集 ${s.id}：${s.obtained}/${s.total} 条`).join('；')+'；公开投稿第1页受限',stop:seasons.map(s=>`合集末条 ${s.last_bvid}`).join('；')+'；投稿第1页入口',reached_source_end:seasons.every(s=>s.reached_end)};
    if(a?.error){try{const report=JSON.parse(a.error);if(report.schema_version===1&&report.kind==='source_status'&&Array.isArray(report.cursors))c.coverage.source_cursors=report.cursors;}catch{}}
    c.coverage.account_history_complete=false;
    const vs=[...videos.values()].filter(v=>v.creator_uid===c.uid),published=vs.filter(v=>v.status==='published').sort(sortVideos);
    c.counts={discovered:vs.length,published:published.length,pending:vs.filter(v=>v.status==='pending').length,excluded:vs.filter(v=>v.status==='excluded').length,searchable_stores:new Set(published.flatMap(v=>v.visits.filter(v=>v.published).map(v=>v.store_id))).size};
    c.latest_discovered=[...vs].sort((a,b)=>b.discovered_at.localeCompare(a.discovered_at)||sortVideos(a,b))[0]||null;
    c.latest_published=published[0]||null;c.sources=[...new Set(c.sources)].sort();
  }
  return {as_of:asOf,definitions:{discovered:'按 BV 去重的已发现线索；可能仍待确认北京分店',published:'当前发布快照中至少有一次核准北京到访的唯一 BV',pending:'未公开且未全部排除的视频；含待盘点样例',excluded:'所有到访均被审核排除且未公开的视频',searchable_stores:'该账号已公开到访的稳定分店 ID 去重数',latest_discovered:'发现/快照登记时间；不能当作B站发稿时间',latest_published:'已公开视频中B站发稿日期最晚者；未知日期置后'},creators:[...creators.values()],videos:[...videos.values()].sort(sortVideos)};
}
function publicCreators(ledger){return ledger.creators.filter(c=>c.counts.published).map(c=>({uid:c.uid,name:c.name,profile_url:c.profile_url,video_count:c.counts.published,store_count:c.counts.searchable_stores}));}
function publicCollection(ledger,uid){
  const creator=publicCreators(ledger).find(c=>c.uid===uid);if(!creator)return null;
  const videos=ledger.videos.filter(v=>v.creator_uid===uid&&v.status==='published').map(v=>({bvid:v.bvid,title:v.title,url:v.url,bilibili_published_at:v.bilibili_published_at,included_at:v.included_at,status:v.status,visits:v.visits.filter(v=>v.published)})).sort(sortVideos);
  return {creator,videos};
}
module.exports={buildLedger,publicCreators,publicCollection,sortVideos};
