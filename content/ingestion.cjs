'use strict';
const {buildLedger}=require('./ledger.cjs');
const {readRegistry,registryKnown,operation}=require('./registry.cjs');
const KEY='private/content-incremental-v1.json';
const MAX_BODY_BYTES=2*1024*1024;
const MAX_CONFLICT_RETRIES=3;
const stamp=value=>Date.parse(value)||0;
const newer=(a,b)=>stamp(a)>stamp(b);
const minDate=(a,b)=>!a?b:!b?a:stamp(a)<=stamp(b)?a:b;
const maxDate=(a,b)=>!a?b:!b?a:stamp(a)>=stamp(b)?a:b;
function fail(message,status=400){const error=new Error(message);error.status=status;throw error;}
function object(value,keys,label){
  if(!value||typeof value!=='object'||Array.isArray(value))fail(label+' 必须是对象');
  if(Object.keys(value).some(key=>!keys.includes(key)))fail(label+' 包含不允许的字段');
}
function string(value,label,{required=false,max=4096}={}){
  if(value===undefined||value===null){if(required)fail(label+' 缺失');return;}
  if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(label+' 无效');
}
function time(value,label,required=false){
  if(value===undefined||value===null){if(required)fail(label+' 缺失');return;}
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value)))fail(label+' 必须是有效ISO时间');
}
function integer(value,label,{required=false,min=0}={}){
  if(value===undefined||value===null){if(required)fail(label+' 缺失');return;}
  if(!Number.isSafeInteger(value)||value<min)fail(label+' 无效');
}
function bool(value,label){if(value!==undefined&&value!==null&&typeof value!=='boolean')fail(label+' 无效');}
function bvid(value,label,required=true){
  if(!required&&(value===undefined||value===null))return;
  if(typeof value!=='string'||!/^BV[0-9A-Za-z]{10}$/.test(value))fail(label+' 必须是合法BV号');
}
function official(value,label,required=true){
  if(!required&&(value===undefined||value===null))return;
  let url;try{url=new URL(value);}catch{fail(label+' 必须是官方API来源');}
  if(typeof value!=='string'||value.length>2048||url.protocol!=='https:'||url.hostname!=='api.bilibili.com'||url.port||url.username||url.password)fail(label+' 必须是官方API来源');
}
function uid(value,known,label){if(typeof value!=='string'||!/^\d+$/.test(value)||!known.has(value))fail(label+' 不在当前账号台账');}
const RANGE_KEYS=['scope','last_page','reached_end','obtained','first_bvid','last_bvid','url'];
function range(value,label){
  if(value===undefined||value===null)return;
  object(value,RANGE_KEYS,label);string(value.scope,label+'.scope');
  for(const key of ['last_page','obtained'])integer(value[key],label+'.'+key);
  bool(value.reached_end,label+'.reached_end');bvid(value.first_bvid,label+'.first_bvid',false);bvid(value.last_bvid,label+'.last_bvid',false);official(value.url,label+'.url',false);
}
const DISCOVERY_KEYS=['bvid','creator_uid','title','published_at','discovered_at','owner_verified','source','checked_at'];
const ACCOUNT_KEYS=['uid','http_status','code','checked_at','url','scope','last_page','reached_end','obtained','first_bvid','last_bvid','restriction','next_step','error','last_success_at','last_success_range'];
const SEASON_KEYS=['id','uid','title','total','obtained','reached_end','last_bvid','source','checked_at'];
const VIDEO_KEYS=['bvid','checked_at','url','http_status','code','owner_uid','owner_verified','title','published_at','duration_seconds','season_id','error'];
const RUN_KEYS=['run_id','checked_at','outcome','partial','sources_checked','sources_ok','sources_restricted','sources_failed','new_count'];
function validateSnapshot(value,known){
  object(value,['schema','updated_at','discoveries','accounts','seasons','videos'],'snapshot');
  if(value.schema!==1)fail('snapshot.schema 必须为1');time(value.updated_at,'snapshot.updated_at',true);
  const normalized={schema:1,updated_at:value.updated_at};
  for(const key of ['discoveries','accounts','seasons','videos']){
    if(!Array.isArray(value[key]))fail('snapshot.'+key+' 必须是数组');
    normalized[key]=value[key].map((row,index)=>{
      const label=key+'['+index+']';
      if(key==='discoveries'){
        object(row,DISCOVERY_KEYS,label);bvid(row.bvid,label+'.bvid');uid(row.creator_uid,known,label+'.creator_uid');
        if(row.owner_verified!==true)fail(label+' 作者归属必须已核实');
        official(row.source,label+'.source');string(row.title,label+'.title');time(row.published_at,label+'.published_at');time(row.discovered_at,label+'.discovered_at',true);time(row.checked_at,label+'.checked_at');
        return {...row,checked_at:row.checked_at||value.updated_at};
      }
      if(key==='accounts'){
        object(row,ACCOUNT_KEYS,label);uid(row.uid,known,label+'.uid');official(row.url,label+'.url');time(row.checked_at,label+'.checked_at',true);
        integer(row.http_status,label+'.http_status');integer(row.code,label+'.code',{min:-Number.MAX_SAFE_INTEGER});
        for(const field of ['scope','restriction','next_step','error'])string(row[field],label+'.'+field);
        for(const field of ['last_page','obtained'])integer(row[field],label+'.'+field);
        bool(row.reached_end,label+'.reached_end');bvid(row.first_bvid,label+'.first_bvid',false);bvid(row.last_bvid,label+'.last_bvid',false);
        time(row.last_success_at,label+'.last_success_at');range(row.last_success_range,label+'.last_success_range');
      }else if(key==='seasons'){
        object(row,SEASON_KEYS,label);uid(row.uid,known,label+'.uid');integer(row.id,label+'.id',{required:true,min:1});official(row.source,label+'.source');time(row.checked_at,label+'.checked_at',true);
        string(row.title,label+'.title');integer(row.total,label+'.total',{required:true});integer(row.obtained,label+'.obtained',{required:true});bool(row.reached_end,label+'.reached_end');bvid(row.last_bvid,label+'.last_bvid',false);
        if(row.obtained>row.total)fail(label+' 取得数量超过合集总量');
      }else{
        object(row,VIDEO_KEYS,label);bvid(row.bvid,label+'.bvid');uid(row.owner_uid,known,label+'.owner_uid');
        if(row.owner_verified!==true)fail(label+' 作者归属必须已核实');
        official(row.url,label+'.url');time(row.checked_at,label+'.checked_at',true);integer(row.http_status,label+'.http_status');integer(row.code,label+'.code',{min:-Number.MAX_SAFE_INTEGER});
        string(row.title,label+'.title');string(row.error,label+'.error');time(row.published_at,label+'.published_at');integer(row.duration_seconds,label+'.duration_seconds');integer(row.season_id,label+'.season_id');
      }
      return {...row};
    });
  }
  return normalized;
}
function validatePayload(payload,known){
  let snapshot,run=null;
  if(payload?.snapshot!==undefined){
    object(payload,['snapshot','run'],'payload');snapshot=validateSnapshot(payload.snapshot,known);
    if(payload.run!==undefined){
      object(payload.run,RUN_KEYS,'run');string(payload.run.run_id,'run.run_id',{required:true,max:200});time(payload.run.checked_at,'run.checked_at',true);string(payload.run.outcome,'run.outcome',{required:true,max:100});bool(payload.run.partial,'run.partial');
      for(const key of ['sources_checked','sources_ok','sources_restricted','sources_failed','new_count'])integer(payload.run[key],'run.'+key);
      run={...payload.run};
    }
  }else snapshot=validateSnapshot(payload,known);
  return {snapshot,run};
}
function lastSuccess(account){
  if(account?.code===0)return {at:account.checked_at,range:{scope:account.scope||null,last_page:account.last_page??null,reached_end:account.reached_end??false,obtained:account.obtained??null,first_bvid:account.first_bvid||null,last_bvid:account.last_bvid||null,url:account.url||null}};
  return {at:account?.last_success_at||null,range:account?.last_success_range||null};
}
function mergeAccounts(previous,current){
  const map=new Map();
  for(const account of [...previous,...current]){
    const old=map.get(account.uid),a=lastSuccess(old),b=lastSuccess(account);
    const success=newer(b.at,a.at)?b:a,latest=!old||newer(account.checked_at,old.checked_at)?account:old;
    map.set(account.uid,{...latest,last_success_at:success.at,last_success_range:success.range});
  }
  return [...map.values()];
}
function mergeEvidence(previous={},current={},baseOwners=new Map()){
  const owners=new Map(baseOwners),discoveries=new Map();
  for(const d of [...(previous.discoveries||[]),...(current.discoveries||[])]){
    if(d.owner_verified!==true)continue;
    if(owners.has(d.bvid)&&owners.get(d.bvid)!==d.creator_uid)fail('候选作者归属与已有台账冲突：'+d.bvid);
    owners.set(d.bvid,d.creator_uid);
    const key=[d.creator_uid,d.bvid,d.source].join(':'),old=discoveries.get(key);
    const latest=!old||newer(d.checked_at||d.discovered_at,old.checked_at||old.discovered_at)?d:old;
    discoveries.set(key,{...latest,discovered_at:minDate(old?.discovered_at,d.discovered_at)});
  }
  const seasons=new Map(),videos=new Map();
  for(const s of [...(previous.seasons||[]),...(current.seasons||[])]){
    const key=s.uid+':'+s.id,old=seasons.get(key);
    if(!old||newer(s.checked_at,old.checked_at))seasons.set(key,s);
  }
  for(const v of [...(previous.videos||[]),...(current.videos||[])]){
    // Frozen verified evidence predates the owner_verified field; new uploads require true.
    if(v.code!==0||!v.owner_uid||v.owner_verified===false)continue;
    if(owners.has(v.bvid)&&owners.get(v.bvid)!==v.owner_uid)fail('官方作者归属与已有台账冲突：'+v.bvid);
    owners.set(v.bvid,v.owner_uid);
    const old=videos.get(v.bvid);if(!old||newer(v.checked_at,old.checked_at))videos.set(v.bvid,v);
  }
  return {schema:1,updated_at:maxDate(previous.updated_at||previous.checked_at,current.updated_at||current.checked_at),discoveries:[...discoveries.values()].sort((a,b)=>stamp(a.checked_at||a.discovered_at)-stamp(b.checked_at||b.discovered_at)),accounts:mergeAccounts(previous.accounts||[],current.accounts||[]),seasons:[...seasons.values()],videos:[...videos.values()]};
}
function json(data,status=200){return Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',Vary:'Authorization, oai-authenticated-user-id'}});}
function unavailable(){return json({error:'候选持久存储暂不可用，未确认更新'},503);}
async function readObject(bucket,known){
  try{
    const object=await bucket.get(KEY);if(!object)return {object:null,value:null};
    if(typeof object.etag!=='string'||!object.etag)throw Error('missing storage etag');
    const stored=await object.json();
    objectCheck(stored,known);
    return {object,value:stored};
  }catch{fail('候选持久存储暂不可用，未确认更新',503);}
}
function objectCheck(stored,known){
  object(stored,['schema','updated_at','discoveries','accounts','seasons','videos','revision','last_run'],'stored');
  const {revision,last_run,...snapshot}=stored;validateSnapshot(snapshot,known);integer(revision,'revision',{required:true,min:1});
  if(last_run!==null&&last_run!==undefined)validatePayload({snapshot,run:last_run},known);
}
async function readPayload(request){
  const declared=Number(request.headers.get('content-length'));if(declared>MAX_BODY_BYTES)fail('采集载荷超过2MiB',413);
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))fail('采集载荷必须为JSON');
  if(!request.body)fail('采集载荷缺失');
  const reader=request.body.getReader(),chunks=[];let size=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();fail('采集载荷超过2MiB',413);}chunks.push(value);}
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {payload:JSON.parse(raw),raw};}catch{fail('采集载荷不是有效JSON');}
}
function receipt(value){
  const counts={discoveries:new Set((value?.discoveries||[]).map(d=>d.bvid)).size,accounts:value?.accounts?.length||0,seasons:value?.seasons?.length||0,videos:value?.videos?.length||0};
  return {revision:value?.revision||0,updated_at:value?.updated_at||null,discovered_count:counts.discoveries,counts,last_run:value?.last_run||null};
}
function frozenEvidence(state){
  return {snapshot:require('./inventory/video-inventory-2026-11-12.json'),access:require('./inventory/access-2026-11-15.json'),historical:require('./inventory/creators-2026-11-11.json'),accounts:state.ledger.creators};
}
function createIngestionService({state=require('./runtime.cjs'),evidence=frozenEvidence(state)}={}){
  const known=new Set((state.ledger?.creators||[]).map(c=>c.uid));
  for(const record of state.records||[])known.add(String(record.creator.uid));
  const baseOwners=new Map((state.ledger?.videos||[]).map(v=>[v.bvid,v.creator_uid]));
  return {
    async handle(request,env={}){
      if(new URL(request.url).pathname!=='/api/admin/content-ingest')return null;
      if(typeof env.FOODMAP_INGEST_TOKEN!=='string'||!env.FOODMAP_INGEST_TOKEN.trim())return json({error:'采集认证未配置'},503);
      if(request.headers.get('Authorization')!=='Bearer '+env.FOODMAP_INGEST_TOKEN)return json({error:'采集认证失败'},401);
      if(!env.CONTENT_UPDATES)return json({error:'候选持久存储未配置'},503);
      if(!['GET','POST'].includes(request.method))return json({error:'仅支持GET和POST'},405);
      try{
        const registry=(await readRegistry(env.CONTENT_UPDATES)).value;
        const publication=require('./publication.cjs').createPublicationService({bucket:env.CONTENT_UPDATES});
        const activeKnown=registryKnown(known,registry);
        if(request.method==='GET')return json({...receipt((await readObject(env.CONTENT_UPDATES,activeKnown)).value),capabilities:['watchlist.sync','receipt.get','blob.chunk','release.stage','release.commit','release.rollback','service.heartbeat'],registry_revision:registry?.registry_revision||0,current_publication:await publication.current()});
        const {payload,raw}=await readPayload(request);
        if(payload?.operation!==undefined){
          if(payload.operation==='watchlist.sync'){if(await env.CONTENT_UPDATES.get('private/requests/'+payload.request_id+'.json'))fail('idempotency_conflict',409);return json(await operation(env.CONTENT_UPDATES,payload,raw));}
          if(payload.operation!=='receipt.get'&&registry?.requests?.[payload.request_id])fail('idempotency_conflict',409);
          if(payload.operation==='receipt.get'){require('./protocol.cjs').validate('operation',payload);const found=await publication.lookup(payload.target_request_id);if(found)return json(found);return json(await operation(env.CONTENT_UPDATES,payload,raw));}
          return json(await publication.operation(payload,raw));
        }
        const {snapshot,run}=validatePayload(payload,activeKnown);
        for(let attempt=0;attempt<=MAX_CONFLICT_RETRIES;attempt++){
          const previous=await readObject(env.CONTENT_UPDATES,activeKnown);
          const merged=mergeEvidence(previous.value||{},snapshot,baseOwners);
          const last_run=run&&(!previous.value?.last_run||newer(run.checked_at,previous.value.last_run.checked_at))?run:previous.value?.last_run||null;
          const value={...merged,revision:(previous.value?.revision||0)+1,last_run};
          const onlyIf=previous.object?{etagMatches:previous.object.etag}:new Headers({'If-None-Match':'*'});
          let written;try{written=await env.CONTENT_UPDATES.put(KEY,JSON.stringify(value),{onlyIf,httpMetadata:{contentType:'application/json',cacheControl:'private, no-store'}});}catch{return unavailable();}
          if(written)return json(receipt(value));
        }
        return json({error:'同时采集产生写入冲突，请重试上传'},409);
      }catch(error){return error.status?json({error:error.message},error.status):unavailable();}
    },
    async privateState(env={},publicState=state){
      if(!env.CONTENT_UPDATES)return state;
      const registry=(await readRegistry(env.CONTENT_UPDATES)).value;
      const activeKnown=registryKnown(known,registry);
      const {value}=await readObject(env.CONTENT_UPDATES,activeKnown);if(!value&&!registry)return state;
      const access=mergeEvidence(evidence.access,value||{});
      // Official metadata can be newer than frozen approved records; only metadata changes.
      const metadata=new Map(access.videos.map(v=>[v.bvid,v]));
      const records=publicState.records.map(record=>{
        const latest=metadata.get(record.video.bvid);
        if(!latest||latest.owner_uid!==String(record.creator.uid))return record;
        return {...record,video:{...record.video,...(latest.title?{title:latest.title}:{}),...(latest.published_at?{published_at:latest.published_at}:{})}};
      });
      const accounts=[...new Map([...(evidence.accounts||[]),...(registry?.accepted_sources||[])].map(c=>[c.uid,c])).values()];
      const ledger=buildLedger({...evidence,accounts,records,access:{...access,checked_at:access.updated_at}});
      return {...publicState,ledger};
    }
  };
}
module.exports={createIngestionService,mergeEvidence,validatePayload,receipt,unavailable,KEY,MAX_BODY_BYTES};
