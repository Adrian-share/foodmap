// Repeatable, incremental, idempotent, concurrency-safe refresh of Beijing food-exploration
// videos from Bilibili. Reuses the endpoints and evidence semantics of
// refresh-creator-inventory.cjs but keeps its own persistent state so every run only records
// what changed and resumes from the last known-good range.
//
// This module is both a CLI entry and a testable library. It stays dependency-free when used
// as a library: `undici` is only loaded lazily when the default fetch is actually used.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');

const SEASON_ID=5780378;
const STATE_SCHEMA=1;
const DEFAULT_MAX_REQUESTS=60;
const REQUEST_TIMEOUT_MS=15000;
const LOCK_STALE_MS=10*60*1000;
const POSTS_SCOPE='公开投稿列表第1页';
const POSTS_NEXT_STEP='提供可访问的官方投稿导出/官方合集或北京原视频链接，核对分店后走批次审核。';
const POSTS_SUCCESS_RESTRICTION='仅访问第1页，不代表历史穷尽';

function resolveFetch(customFetch){
  if(customFetch)return customFetch;
  // Lazy: tests never reach this branch, so they don't need undici installed.
  const {fetch,ProxyAgent}=require('undici');
  const dispatcher=process.env.HTTPS_PROXY?new ProxyAgent(process.env.HTTPS_PROXY):undefined;
  return (url,init={})=>fetch(url,dispatcher?{...init,dispatcher}:init);
}

async function fetchJson(fetchImpl,url,signal){
  signal?.throwIfAborted();
  const timeout=AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const r=await fetchImpl(url,{signal:signal?AbortSignal.any([signal,timeout]):timeout});
  let body;
  if(typeof r.text==='function')body=await r.text();
  else if(typeof r.json==='function')body=JSON.stringify(await r.json());
  else body='';
  let data;try{data=JSON.parse(body);}catch{data=undefined;}
  return {http_status:typeof r.status==='number'?r.status:null,code:data?.code,data,url};
}

// ---- persistent state -------------------------------------------------------

function normalizeState(s){
  return {
    schema:STATE_SCHEMA,
    updated_at:s?.updated_at||null,
    discoveries:Array.isArray(s?.discoveries)?s.discoveries:[],
    accounts:mergeAccounts(Array.isArray(s?.accounts)?s.accounts:[],[]),
    seasons:Array.isArray(s?.seasons)?s.seasons:[],
    videos:mergeVideoMetadata([],Array.isArray(s?.videos)?s.videos:[]),
    failures:(s?.failures&&typeof s.failures==='object'&&!Array.isArray(s.failures))?s.failures:{},
  };
}

function readStateFile(file){
  try{
    const s=JSON.parse(fs.readFileSync(file,'utf8'));
    if(!s||Array.isArray(s)||s.schema!==STATE_SCHEMA||
       !['discoveries','accounts','seasons'].every(key=>Array.isArray(s[key]))||
       (s.videos!==undefined&&!Array.isArray(s.videos))||
       (s.failures!==undefined&&(!s.failures||typeof s.failures!=='object'||Array.isArray(s.failures)))){
      throw new Error('unsupported schema or invalid state fields');
    }
    return normalizeState(s);
  }catch(e){throw new Error('invalid incremental state '+file+': '+e.message,{cause:e});}
}

// A new checkout resumes from the persistent directory; first initialization can import
// its publishable snapshot or the frozen access evidence. Invalid files are never reseeded.
function loadState(statePath,root){
  if(fs.existsSync(statePath))return readStateFile(statePath);
  const snapshotPath=path.join(root,'content/inventory/incremental-state.json');
  if(snapshotPath!==statePath&&fs.existsSync(snapshotPath))return readStateFile(snapshotPath);
  const accessPath=path.join(root,'content/inventory/access-2026-11-15.json');
  let access={};
  if(fs.existsSync(accessPath))access=JSON.parse(fs.readFileSync(accessPath,'utf8'));
  return normalizeState({
    schema:STATE_SCHEMA,
    updated_at:access.checked_at||null,
    discoveries:access.discoveries||[],
    accounts:access.accounts||[],
    seasons:access.seasons||[],
    videos:access.videos||[],
    failures:{},
  });
}

function saveState(statePath,state){
  fs.mkdirSync(path.dirname(statePath),{recursive:true});
  const tmp=statePath+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n');
  fs.renameSync(tmp,statePath);
}

// ---- lock ------------------------------------------------------------------

function lockOwnerAlive(lockPath){
  const pid=Number(fs.readFileSync(lockPath,'utf8').trim());
  if(!Number.isSafeInteger(pid)||pid<=0)return false;
  try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}
}

function acquireLock(lockPath,staleMs=LOCK_STALE_MS){
  fs.mkdirSync(path.dirname(lockPath),{recursive:true});
  for(let attempt=0;attempt<2;attempt++){
    try{
      const fd=fs.openSync(lockPath,'wx');
      try{fs.writeSync(fd,String(process.pid)+'\n');}finally{fs.closeSync(fd);}
      return {held:true,path:lockPath};
    }catch(e){
      if(e.code!=='EEXIST')return {held:false,error:e};
      let stale=false;
      try{stale=Date.now()-fs.statSync(lockPath).mtimeMs>staleMs&&!lockOwnerAlive(lockPath);}catch{stale=true;}
      if(stale){try{fs.rmSync(lockPath,{force:true});}catch{}continue;}
      return {held:false,error:e};
    }
  }
  return {held:false,error:new Error('lock busy after retry')};
}

function releaseLock(lockPath){
  try{fs.rmSync(lockPath,{force:true});return true;}
  catch(e){console.warn('warning: failed to remove lock file '+lockPath+': '+e.message);return false;}
}

// ---- merge semantics (mirrors refresh-creator-inventory.cjs) ----------------

// Dedup discoveries by creator_uid:bvid:source, keep the earliest discovered_at.
function mergeDiscovery(previous,current){
  const discoveries=new Map();
  for(const v of [...(previous.discoveries||[]),...(current.discoveries||[])]){
    const key=[v.creator_uid,v.bvid,v.source].join(':');
    const old=discoveries.get(key);
    discoveries.set(key,{...old,...v,discovered_at:old?.discovered_at||v.discovered_at});
  }
  const seasons=new Map([...(previous.seasons||[]),...(current.seasons||[])].map(s=>[s.id,s]));
  return {...current,discoveries:[...discoveries.values()],seasons:[...seasons.values()]};
}

function newer(a,b){
  if(!a)return false;
  if(!b)return true;
  return Date.parse(a)>=Date.parse(b);
}

function mergeByKey(previous,current,keyOf){
  const map=new Map();
  for(const item of [...(previous||[]),...(current||[])]){
    const key=keyOf(item);
    if(key===undefined||key===null||key==='')continue;
    const old=map.get(key);
    if(!old||newer(item.checked_at,old.checked_at))map.set(key,item);
  }
  return [...map.values()];
}

function successfulEvidence(e){
  return e?.code===0&&(e.http_status===undefined||(e.http_status>=200&&e.http_status<300));
}

function accountSuccess(a){
  if(successfulEvidence(a))return {at:a.checked_at,range:{
    scope:a.scope||null,last_page:a.last_page??null,reached_end:a.reached_end??false,
    obtained:a.obtained??null,first_bvid:a.first_bvid||null,last_bvid:a.last_bvid||null,url:a.url||null,
  }};
  return {at:a?.last_success_at||null,range:a?.last_success_range||null};
}

// Keep the latest attempt, including restrictions/errors, alongside the independent last
// successful range. HTTP failures and network failures obey the same preservation rule.
function mergeAccounts(previous,current){
  const map=new Map();
  for(const a of [...(previous||[]),...(current||[])]){
    if(!a?.uid)continue;
    const key=String(a.uid),old=map.get(key);
    const prior=accountSuccess(old),incoming=accountSuccess(a);
    const success=newer(incoming.at,prior.at)?incoming:prior;
    const latest=!old||newer(a.checked_at,old.checked_at)?a:old;
    map.set(key,{...latest,last_success_at:success.at,last_success_range:success.range});
  }
  return [...map.values()];
}

// Metadata is successful, verified view evidence. Never replace it with a newer failure,
// and retain only fields needed for inventory/building (no raw response or media URLs).
function mergeVideoMetadata(previous,current){
  const map=new Map();
  for(const v of [...(previous||[]),...(current||[])]){
    if(!successfulEvidence(v)||!/^BV[0-9A-Za-z]{10}$/.test(v.bvid)||!/^\d+$/.test(String(v.owner_uid||''))||v.owner_verified===false)continue;
    const old=map.get(v.bvid);
    if(old&&!newer(v.checked_at,old.checked_at))continue;
    const {bvid,checked_at,url,http_status,code,owner_uid,owner_verified,title,published_at,duration_seconds,season_id}=v;
    map.set(bvid,{bvid,checked_at,url,http_status,code,owner_uid:String(owner_uid),owner_verified,title,published_at,duration_seconds,season_id});
  }
  return [...map.values()];
}

// ---- planning --------------------------------------------------------------

function buildKnownBvids({seed={},ledger={},discoveries=[]}){
  const set=new Set();
  for(const v of seed.videos||[])if(v?.bvid)set.add(v.bvid);
  for(const v of ledger.videos||[])if(v?.bvid)set.add(v.bvid);
  for(const d of discoveries||[])if(d?.bvid)set.add(d.bvid);
  return set;
}

const SPECIAL_BVIDS=['BV1NG6kYTEXG','BV1gkxKefEfW','BV1k1KN6BEvw'];
const SEASON_OWNER_UID='3546728118618546';
const SEASON_ANCHOR_BVID='BV1NG6kYTEXG';

function planSources({seed={},ledger={},state={}}){
  const creators=[...new Map([...(seed.creators||[]),...(ledger.creators||[])].map(c=>[String(c.uid),c])).values()];
  const discovered=new Set((state.discoveries||[]).map(d=>d.bvid));
  const candidates=[...new Map([
    ...(seed.videos||[]).filter(v=>!discovered.has(v.bvid)&&((v.sources||[]).includes('candidate_samples')||v.status==='已公开'||SPECIAL_BVIDS.includes(v.bvid))),
    ...(ledger.videos||[]).filter(v=>!discovered.has(v.bvid)),
  ].map(v=>[v.bvid,v])).values()];
  // This verified official entry stays in every Beijing run, even after all candidate BV
  // metadata has been discovered. Place it first so normal request limits retain the poll.
  const pollSeason=creators.some(c=>String(c.uid)===SEASON_OWNER_UID)||(state.seasons||[]).some(s=>s.id===SEASON_ID);
  const views=pollSeason?[{bvid:SEASON_ANCHOR_BVID,creator_uid:SEASON_OWNER_UID},...candidates.filter(v=>v.bvid!==SEASON_ANCHOR_BVID)]:candidates;
  const sources=[
    ...(pollSeason?[{key:`view:${SEASON_ANCHOR_BVID}`,type:'view',bvid:SEASON_ANCHOR_BVID,uid:SEASON_OWNER_UID,url:`https://api.bilibili.com/x/web-interface/view?bvid=${SEASON_ANCHOR_BVID}`}]:[]),
    ...creators.map(c=>({key:`posts:${String(c.uid)}`,type:'posts',uid:String(c.uid),url:`https://api.bilibili.com/x/space/wbi/arc/search?mid=${c.uid}&pn=1&ps=30&order=pubdate`})),
    ...views.filter(v=>!pollSeason||v.bvid!==SEASON_ANCHOR_BVID).map(v=>({key:`view:${v.bvid}`,type:'view',bvid:v.bvid,uid:v.creator_uid?String(v.creator_uid):null,url:`https://api.bilibili.com/x/web-interface/view?bvid=${v.bvid}`})),
  ];
  return {creators,candidates:views,sources};
}

// ---- failure backoff -------------------------------------------------------

function failureKeyState(state,key){
  if(!state.failures)state.failures={};
  return state.failures[key]||{};
}

function isDeferred(state,key,nowIso){
  const f=failureKeyState(state,key);
  if(!f?.next_retry_after)return false;
  return Date.parse(f.next_retry_after)>Date.parse(nowIso);
}

function recordFailure(state,key,nowIso){
  if(!state.failures)state.failures={};
  const prev=state.failures[key]||{};
  const consecutive=(prev.consecutive_failures||0)+1;
  const minutes=Math.min(2**consecutive,60);
  state.failures[key]={
    consecutive_failures:consecutive,
    last_failure_at:nowIso,
    next_retry_after:new Date(Date.parse(nowIso)+minutes*60000).toISOString(),
  };
}

function clearFailure(state,key){
  if(state.failures&&key in state.failures)delete state.failures[key];
}

// ---- classification --------------------------------------------------------

function classifyOutcome({locked=false,attempted=0,failed=0,restricted=0,newCount=0,deferred=0,skipped=0}){
  if(locked)return 'locked';
  if(attempted===0)return deferred>0&&skipped===0?'deferred':'incomplete';
  if(deferred>0||skipped>0)return 'partial';
  if(failed===attempted)return 'failed';
  if(failed>0||restricted>0)return 'partial';
  if(newCount>0)return 'new_content';
  return 'no_new';
}

function lastSuccessRanges(state){
  const out={};
  for(const a of state.accounts||[]){
    const uid=String(a.uid);
    out[uid]={
      last_checked_at:a.checked_at||null,
      last_success_at:a.last_success_at||null,
      last_success_range:a.last_success_range||null,
      http_status:a.http_status??null,code:a.code??null,error:a.error||null,
      restriction:a.restriction||null,
      seasons:(state.seasons||[]).filter(s=>String(s.uid)===uid).map(s=>({id:s.id,title:s.title,obtained:s.obtained,total:s.total,last_bvid:s.last_bvid,reached_end:s.reached_end,checked_at:s.checked_at})),
    };
  }
  return out;
}

// ---- main run --------------------------------------------------------------

function sanitizeCheckedAt(iso){
  return String(iso).replace(/[:.]/g,'-');
}

function writeReport(report,runsDir,checkedAt){
  const dir=report.run_dir||path.join(runsDir,sanitizeCheckedAt(checkedAt));
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'report.json');
  fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');
  return file;
}

function errorString(e){
  return `${e?.name||'Error'}:${e?.message||e}`;
}

async function runIncremental(options={}){
  const root=options.root||path.join(__dirname,'..');
  const stateDir=path.resolve(process.env.FOODMAP_AGENT_STATE_DIR||path.join(os.homedir(),'foodmap-agent-state'));
  const statePath=options.state||path.join(stateDir,'incremental-state.json');
  const runsDir=options.runsDir||path.join(stateDir,'runs');
  const snapshotPath=path.join(root,'content/inventory/incremental-state.json');
  if(path.resolve(statePath)===path.resolve(snapshotPath))throw new Error('persistent state must be separate from the publishable snapshot');
  const maxRequests=Number.isFinite(options.maxRequests)?options.maxRequests:DEFAULT_MAX_REQUESTS;
  const dryRun=!!options.dryRun;
  const run_id=crypto.randomUUID();
  const checked_at=new Date().toISOString();

  const seed=options.seed!==undefined?options.seed:JSON.parse(fs.readFileSync(path.join(root,'content/inventory/video-inventory-2026-11-12.json'),'utf8'));
  const ledger=options.ledger!==undefined?options.ledger:require(path.join(root,'content/runtime.cjs')).ledger;

  if(dryRun){
    const state=loadState(statePath,root);
    const known=buildKnownBvids({seed,ledger,discoveries:state.discoveries});
    const plan=planSources({seed,ledger,state});
    const deferred=plan.sources.filter(s=>isDeferred(state,s.key,checked_at)).map(s=>s.key);
    const report={
      run_id,checked_at,dry_run:true,outcome:null,
      state_file:statePath,runs_dir:runsDir,max_requests:maxRequests,
      snapshot_file:snapshotPath,
      known_bvid_count:known.size,
      creators:plan.creators.map(c=>({uid:String(c.uid),name:c.name||''})),
      view_candidates:plan.candidates.map(v=>v.bvid),
      planned_sources:plan.sources.map(s=>s.key),
      deferred_sources:deferred,
      would_write_state_file:statePath,
      would_write_snapshot_file:snapshotPath,
      would_write_report_dir:path.join(runsDir,sanitizeCheckedAt(checked_at)),
    };
    return report;
  }

  options.signal?.throwIfAborted();
  const lock=acquireLock(statePath+'.lock');
  if(!lock.held){
    if(lock.error?.code&&lock.error.code!=='EEXIST')throw lock.error;
    const report={
      run_id,checked_at,outcome:'locked',
      partial:true,state_file:statePath,runs_dir:runsDir,snapshot_file:snapshotPath,
      sources_checked:0,sources_ok:0,sources_restricted:0,sources_failed:0,sources_deferred:0,sources_skipped_limit:0,
      requests_made:0,discovered_total:0,new_candidates:[],duplicate_count:0,pending_total:0,
      last_success_ranges:{},errors:[],
    };
    return report;
  }

  try{
    options.signal?.throwIfAborted();
    const state=loadState(statePath,root);
    const known=buildKnownBvids({seed,ledger,discoveries:state.discoveries});
    const plan=planSources({seed,ledger,state});
    const fetchImpl=resolveFetch(options.fetch);
    const current={checked_at,discoveries:[],accounts:[],seasons:[],videos:[]};
    let ok=0,restricted=0,failed=0,deferred=0,skipped=0,requests=0;
    const errors=[];
    for(const src of plan.sources){
      options.signal?.throwIfAborted();
      if(isDeferred(state,src.key,checked_at)){deferred++;continue;}
      if(requests>=maxRequests){skipped++;continue;}
      try{
        requests++;
        const r=await fetchJson(fetchImpl,src.url,options.signal);
        options.signal?.throwIfAborted();
        const successful=successfulEvidence(r);
        if(src.type==='posts'){
          const posts=r.data?.data?.list?.vlist;
          if(successful&&!Array.isArray(posts))throw new Error('successful posts response is missing a video list');
          const account={
            uid:String(src.uid),http_status:r.http_status,code:r.code,checked_at,url:src.url,
            scope:POSTS_SCOPE,last_page:1,reached_end:false,
            ...(successful?{obtained:posts.length,first_bvid:posts[0]?.bvid||null,last_bvid:posts.at(-1)?.bvid||null}:{}),
            restriction:successful?POSTS_SUCCESS_RESTRICTION:`入口受限：HTTP ${r.http_status??'无响应'} / code ${r.code??'非JSON'}`,
            next_step:POSTS_NEXT_STEP,
          };
          current.accounts.push(account);
          if(successful){
            ok++;clearFailure(state,src.key);
            for(const v of posts){
              current.discoveries.push({
                bvid:v.bvid,creator_uid:String(src.uid),title:v.title,
                published_at:new Date(v.created*1000).toISOString(),
                discovered_at:checked_at,owner_verified:String(v.mid)===String(src.uid),source:src.url,
              });
            }
          }else{
            restricted++;
            recordFailure(state,src.key,checked_at);
            errors.push({source:src.key,error:`HTTP ${r.http_status??'无响应'} / code ${r.code??'非JSON'}`});
          }
        }else{
          const d=r.data?.data;
          const ownerUid=d?.owner?.mid===undefined?null:String(d.owner.mid);
          const ownerVerified=!!ownerUid&&(src.uid?ownerUid===String(src.uid):plan.creators.some(c=>String(c.uid)===ownerUid));
          current.videos.push({
            bvid:src.bvid,checked_at,url:src.url,http_status:r.http_status,code:r.code,error:null,
            owner_uid:ownerUid,owner_verified:ownerVerified,title:d?.title,
            published_at:d?new Date(d.pubdate*1000).toISOString():null,duration_seconds:d?.duration,season_id:d?.season_id,
          });
          if(successful){
            ok++;clearFailure(state,src.key);
            if(ownerUid){
              current.discoveries.push({
                bvid:src.bvid,creator_uid:ownerUid,title:d.title,
                published_at:new Date(d.pubdate*1000).toISOString(),discovered_at:checked_at,
                owner_verified:ownerVerified,
                source:src.url,
              });
            }
            const s=d?.ugc_season;
            if(s?.id===SEASON_ID&&!current.seasons.some(x=>x.id===s.id)){
              const episodes=(s.sections||[]).flatMap(sec=>sec.episodes||[]);
              current.seasons.push({
                id:s.id,uid:String(s.mid),title:s.title,total:s.ep_count,
                obtained:episodes.length,reached_end:episodes.length===s.ep_count,
                last_bvid:episodes.at(-1)?.bvid,source:src.url,checked_at,
              });
              for(const e of episodes){
                current.discoveries.push({
                  bvid:e.bvid,creator_uid:String(s.mid),title:e.arc.title,
                  published_at:new Date(e.arc.pubdate*1000).toISOString(),
                  discovered_at:checked_at,owner_verified:String(e.arc.author?.mid)===String(s.mid),source:src.url+'#season-'+s.id,
                });
              }
              clearFailure(state,'season:'+SEASON_ID);
            }
          }else{
            restricted++;
            recordFailure(state,src.key,checked_at);
            errors.push({source:src.key,error:`HTTP ${r.http_status??'无响应'} / code ${r.code??'非JSON'}`});
          }
        }
      }catch(e){
        options.signal?.throwIfAborted();
        failed++;errors.push({source:src.key,error:errorString(e)});
        recordFailure(state,src.key,checked_at);
        if(src.type==='posts'){
          current.accounts.push({
            uid:String(src.uid),http_status:null,code:null,checked_at,url:src.url,
            scope:POSTS_SCOPE,last_page:1,reached_end:false,
            restriction:`入口受限：HTTP 无响应 / code ${errorString(e)}`,
            next_step:POSTS_NEXT_STEP,error:errorString(e),
          });
        }else{
          current.videos.push({bvid:src.bvid,checked_at,url:src.url,http_status:null,code:null,error:errorString(e)});
        }
      }
    }
    options.signal?.throwIfAborted();
    const attempted=ok+restricted+failed;
    const newCandidates=new Map();
    let duplicateCount=0;
    for(const d of current.discoveries){
      if(known.has(d.bvid))duplicateCount++;
      else if(!newCandidates.has(d.bvid))newCandidates.set(d.bvid,{bvid:d.bvid,creator_uid:d.creator_uid,title:d.title,published_at:d.published_at});
    }
    const new_candidates=[...newCandidates.values()];

    // Merge this run's evidence into persistent state (discoveries: earliest wins; accounts/seasons: newest wins).
    state.discoveries=mergeDiscovery(state,current).discoveries;
    state.accounts=mergeAccounts(state.accounts,current.accounts);
    state.seasons=mergeByKey(state.seasons,current.seasons,s=>s.id);
    const knownCreatorUids=new Set(plan.creators.map(c=>String(c.uid)));
    state.videos=mergeVideoMetadata(state.videos,current.videos.filter(v=>knownCreatorUids.has(v.owner_uid)&&v.owner_verified===true));
    state.updated_at=checked_at;

    // Pending count after applying this run's discoveries to the known ledger.
    const ledgerBvids=new Set((ledger.videos||[]).map(v=>v.bvid));
    const ledgerCreatorUids=new Set((ledger.creators||[]).map(c=>String(c.uid)));
    const addedPending=new Set();
    let pendingAdd=0;
    for(const d of current.discoveries){
      if(!addedPending.has(d.bvid)&&ledgerCreatorUids.has(String(d.creator_uid))&&d.owner_verified===true&&!ledgerBvids.has(d.bvid)){
        pendingAdd++;addedPending.add(d.bvid);
      }
    }
    const pending_total=(ledger.videos||[]).filter(v=>v.status==='pending').length+pendingAdd;

    const outcome=classifyOutcome({locked:false,attempted,failed,restricted,deferred,skipped,newCount:new_candidates.length});
    const report={
      run_id,checked_at,outcome,
      partial:attempted===0||failed>0||restricted>0||deferred>0||skipped>0,
      state_file:statePath,runs_dir:runsDir,snapshot_file:snapshotPath,
      sources_checked:attempted,sources_ok:ok,sources_restricted:restricted,sources_failed:failed,
      sources_deferred:deferred,sources_skipped_limit:skipped,requests_made:requests,
      discovered_total:current.discoveries.length,new_candidates,duplicate_count:duplicateCount,
      pending_total,last_success_ranges:lastSuccessRanges(state),errors,
    };

    report.run_dir=path.join(runsDir,sanitizeCheckedAt(checked_at)+'-'+run_id);
    report.run_snapshot_file=path.join(report.run_dir,'snapshot.json');

    saveState(statePath,state);
    const {schema,updated_at,discoveries,accounts,seasons,videos}=state;
    saveState(snapshotPath,{schema,updated_at,discoveries,accounts,seasons,videos});
    saveState(report.run_snapshot_file,{schema,updated_at,discoveries,accounts,seasons,videos});
    writeReport(report,runsDir,checked_at);
    return report;
  }finally{
    releaseLock(statePath+'.lock');
  }
}

function printSummary(report){
  console.log(`增量刷新 outcome=${report.outcome} partial=${report.partial}`);
  console.log(`sources checked=${report.sources_checked} ok=${report.sources_ok} restricted=${report.sources_restricted} failed=${report.sources_failed} deferred=${report.sources_deferred} skipped_limit=${report.sources_skipped_limit}`);
  console.log(`requests=${report.requests_made} discovered=${report.discovered_total} new=${report.new_candidates.length} duplicate=${report.duplicate_count} pending=${report.pending_total}`);
  for(const c of report.new_candidates)console.log(`new ${c.bvid} ${c.creator_uid} ${c.title}`);
  for(const e of report.errors)console.log(`error ${e.source} ${e.error}`);
}

function printPlan(report){
  console.log(`dry-run: 将抓取但不会写入状态或发起请求`);
  console.log(`known_bvid=${report.known_bvid_count} creators=${report.creators.length} view_candidates=${report.view_candidates.length} planned_sources=${report.planned_sources.length}`);
  console.log(`state_file=${report.state_file}`);
  console.log(`runs_dir=${report.runs_dir}`);
  console.log(`snapshot_file=${report.snapshot_file}`);
  console.log(`deferred=${report.deferred_sources.length} ${report.deferred_sources.join(' ')}`);
  console.log(`sources: ${report.planned_sources.join(' ')}`);
}

function parseArgs(argv){
  const out={dryRun:false,state:null,runsDir:null,limit:null,json:false};
  for(let i=2;i<argv.length;i++){
    const a=argv[i];
    if(a==='--dry-run')out.dryRun=true;
    else if(a==='--json')out.json=true;
    else if(a==='--state')out.state=argv[++i];
    else if(a==='--runs-dir')out.runsDir=argv[++i];
    else if(a==='--limit')out.limit=Number(argv[++i]);
  }
  return out;
}

if(require.main===module){
  const args=parseArgs(process.argv);
  const root=path.join(__dirname,'..');
  runIncremental({
    root,
    state:args.state?path.resolve(args.state):undefined,
    runsDir:args.runsDir?path.resolve(args.runsDir):undefined,
    maxRequests:args.limit??DEFAULT_MAX_REQUESTS,
    dryRun:args.dryRun,
  }).then(report=>{
    if(report.dry_run){
      if(args.json)console.log(JSON.stringify(report,null,2));
      else printPlan(report);
    }else{
      if(args.json)console.log(JSON.stringify(report,null,2));
      else printSummary(report);
    }
  }).catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
}

module.exports={acquireLock,releaseLock,loadState,saveState,buildKnownBvids,planSources,runIncremental,mergeDiscovery,mergeAccounts,mergeVideoMetadata,classifyOutcome};
