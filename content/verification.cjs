'use strict';
// Conservative deterministic checks over adapter-registered raw evidence, never Pi's confidence.
const {validate,sha,encode,strict}=require('./protocol.cjs');
const {visitKey}=require('./catalog.cjs');
const RULES='v1';
const norm=s=>String(s||'').normalize('NFKC').replace(/[\s，,。·、（）()：:]/g,'');
const safe=s=>typeof s==='string'&&s.trim()&&!/[<>\u0000-\u001f]/.test(s)&&!/(?:token|cookie|authorization|api[_-]?key)\s*[:=]/i.test(s);
function official(s){try{const u=new URL(s.source_url);if(u.protocol!=='https:'||u.username||u.password||u.port)return false;return s.kind==='metadata'?u.hostname==='api.bilibili.com'&&u.pathname==='/x/web-interface/view':s.kind==='subtitle'?/(^|\.)hdslb\.com$/.test(u.hostname):s.kind==='poi'?u.hostname==='restapi.amap.com'&&u.pathname==='/v5/place/text':['frame','branch'].includes(s.kind)?u.hostname==='www.bilibili.com'&&/^\/video\/BV[1-9A-HJ-NP-Za-km-z]{10}\/$/.test(u.pathname):false;}catch{return false;}}
async function verifyExtraction(input){
 const excluded=missing=>({status:'excluded',records:[],documents:[],missing});
 const pending=missing=>({status:'pending',records:[],documents:[],missing:[...new Set(missing)]});
 try{
  strict(input,['checked_at','identity','pi','proposal','sources']);validate('extraction',input.proposal);
  strict(input.identity,['task_id','creator_uid','bvid','part']);
  if(!Number.isFinite(Date.parse(input.checked_at))||input.sources.length>100)return pending(['evidence']);
  const p=input.proposal,id=input.identity;
  if(Object.keys(id).some(k=>id[k]!==p[k]))return pending(['identity']);
  if(p.classification!=='beijing'||p.missing.length||!p.visits.length)return pending(p.missing.length?p.missing:['branch']);
  const sources=new Map();
  for(const s of input.sources){
   strict(s,['id','kind','payload','sha256','source_url','checked_at']);
   if(sources.has(s.id)||!official(s)||!Number.isFinite(Date.parse(s.checked_at))||await sha(encode(s.payload))!==s.sha256)return pending(['evidence_hash_or_source']);
   sources.set(s.id,s);
  }
  if(p.evidence_ids.some(id=>!sources.has(id)))return pending(['evidence']);
  const segments=[...p.visits].sort((a,b)=>a.start_seconds-b.start_seconds);
  if(segments.some((v,i)=>i&&v.start_seconds<segments[i-1].end_seconds))return pending(['overlapping_visits']);
  const records=[],documents=[],missing=[];
  for(const v of p.visits){
   const listed=[...new Set([...v.evidence_ids,...v.screenshot_ids])].map(e=>sources.get(e));
   if(listed.some(s=>!s)){missing.push('evidence');continue;}
   const meta=listed.find(s=>s.kind==='metadata'),raw=meta?.payload,data=raw?.data,page=data?.pages?.find(pg=>pg.page===id.part);
   const checks={owner:raw?.code===0&&data?.bvid===id.bvid&&String(data?.owner?.mid)===id.creator_uid&&!!page,
    branch:false,poi:false,segment:false,frame:false,description:false};
   if(raw?.code===0&&data?.bvid===id.bvid&&String(data?.owner?.mid)!==id.creator_uid)return excluded(['wrong_owner']);
   checks.segment=Number.isFinite(page?.duration)&&v.start_seconds>=0&&v.end_seconds>v.start_seconds&&v.end_seconds<=page.duration;
   const subtitles=listed.filter(s=>s.kind==='subtitle'&&s.payload.bvid===id.bvid&&s.payload.part===id.part&&s.payload.cid===page?.cid);
   const ocr=listed.filter(s=>s.kind==='branch'&&s.payload.engine==='apple-vision-v1'&&s.payload.bvid===id.bvid&&s.payload.part===id.part&&s.payload.cid===page?.cid&&listed.some(f=>f.kind==='frame'&&f.payload.sha256===s.payload.image_sha256&&Math.abs(f.payload.actual_timestamp_ms-s.payload.timestamp_ms)<=1));
   const ocrLines=ocr.flatMap(s=>(s.payload.lines||[]).filter(l=>l.confidence>=0.9).map(l=>({from:s.payload.timestamp_ms/1000,to:s.payload.timestamp_ms/1000+0.001,content:l.text,source:s})));
   const lines=[...ocrLines.filter(t=>t.from>=v.start_seconds&&t.to<=v.end_seconds&&safe(t.content)),...subtitles.flatMap(s=>(s.payload.body||[]).filter(t=>Number.isFinite(t.from)&&Number.isFinite(t.to)&&t.from>=v.start_seconds&&t.to<=v.end_seconds&&t.to>t.from&&safe(t.content)).map(t=>({...t,source:s})))];
   const text=norm(lines.map(t=>t.content).join(''));
   const pois=listed.filter(s=>s.kind==='poi'&&s.payload.status==='1').flatMap(s=>(s.payload.pois||[]).map(poi=>({poi,source:s})));
   const away=pois.find(({poi:q})=>q.cityname&&q.cityname!=='北京市'&&text.includes(norm(q.cityname))&&text.includes(norm(q.address))&&norm(q.name).includes(norm(v.store_name))&&norm(q.name).includes(norm(v.branch_name)));
   if(away)return excluded(['non_beijing']);
   const candidates=[...new Map(pois.filter(({poi:q})=>q.cityname==='北京市'&&safe(q.name)&&safe(q.address)&&safe(q.adname)&&norm(q.name).includes(norm(v.store_name))&&norm(q.name).includes(norm(v.branch_name))&&text.includes(norm(q.address))&&norm(v.address_hint).includes(norm(q.address))).map(q=>[q.poi.id,q])).values()];
   const match=candidates.length===1&&v.poi_candidates.includes(candidates[0].poi.id)?candidates[0]:null;
   const poi=match?.poi,[lng,lat]=String(poi?.location||'').split(',').map(Number);
   if(match&&['closed','moved'].includes(poi.business_status))return excluded(['closed_or_moved']);
   checks.poi=!!match&&Number.isFinite(lng)&&Number.isFinite(lat)&&lng>=115.4&&lng<=117.6&&lat>=39.4&&lat<=41.1&&!['closed','moved'].includes(poi.business_status);
   checks.branch=checks.poi&&safe(v.store_name)&&safe(v.branch_name)&&text.includes(norm(v.store_name))&&text.includes(norm(v.branch_name));
   const line=lines.find(t=>safe(v.description)&&t.content.includes(v.description));
   checks.description=!!line;
   const frames=listed.filter(s=>s.kind==='frame'&&v.screenshot_ids.includes(s.id));
   const validFrames=frames.filter(({payload:f,source_url})=>source_url==='https://www.bilibili.com/video/'+id.bvid+'/'&&f.bvid===id.bvid&&f.part===id.part&&f.cid===page?.cid&&f.timestamp_ms>=v.start_seconds*1000&&f.timestamp_ms<=v.end_seconds*1000&&Number.isFinite(f.actual_timestamp_ms)&&Math.abs(f.actual_timestamp_ms-f.timestamp_ms)<=1000&&f.mean>=8&&f.mean<=247&&f.stddev>=8&&['official-player-video-element','official-stream-pipe'].includes(f.capture_method)&&/^[a-f0-9]{64}$/.test(f.sha256)&&f.width>=32&&f.height>=32&&f.width<=8192&&f.height<=8192&&f.width*f.height<=32*1024*1024&&f.bytes>0&&f.bytes<=8*1024*1024&&['image/png','image/jpeg','image/webp'].includes(f.mime_type));
   checks.frame=validFrames.length>0&&validFrames.length===frames.length;
   const failed=Object.keys(checks).filter(k=>!checks[k]);
   if(failed.length){missing.push(...failed);continue;}
   const evidence=listed.map(s=>({evidence_id:s.id,kind:s.kind,sha256:s.sha256,source_url:s.source_url,checked_at:s.checked_at,...(s.kind==='frame'?{seconds:s.payload.actual_timestamp_ms/1000}:s.kind==='subtitle'?{seconds:line.from}:{})}));
   const verification={schema_version:1,task_id:id.task_id,visit_key:id.bvid+':'+id.part+':'+v.id,rules_version:RULES,checked_at:input.checked_at,result:'approved',checks,evidence,missing:[],pi:input.pi};validate('verification',verification);
   const document={schema_version:1,input:{...input,proposal:{...p,visits:[v]}},verification};
   const bytes=encode(document),verificationId=await sha(bytes);
   const record={creator:{uid:id.creator_uid,name:data.owner.name,profile_url:'https://space.bilibili.com/'+id.creator_uid},video:{bvid:id.bvid,url:'https://www.bilibili.com/video/'+id.bvid+'/',owner_uid:id.creator_uid,title:data.title,part:id.part,published_at:new Date(data.pubdate*1000).toISOString(),duration_seconds:page.duration,metadata_status:'verified'},visit:{id:v.id,store_id:'amap:'+poi.id,store_name:v.store_name,branch_name:v.branch_name,city:'北京市',district:poi.adname,address:poi.address,amap_poi_id:poi.id,amap_url:'https://ditu.amap.com/place/'+poi.id,gcj02:{lng,lat},start_seconds:v.start_seconds,end_seconds:v.end_seconds,business_status:'unknown',evidence:[{type:'branch',status:'verified',url:'https://www.bilibili.com/video/'+id.bvid+'/',seconds:line.from},{type:'amap',status:'verified',url:'https://ditu.amap.com/place/'+poi.id}],screenshots:validFrames.map(({payload:f,checked_at})=>({path:'content/images/'+f.sha256+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[f.mime_type]),source_video:'https://www.bilibili.com/video/'+id.bvid+'/',part:id.part,timestamp_ms:f.actual_timestamp_ms,sha256:f.sha256,alt:v.store_name+'（'+v.branch_name+'）原视频 '+f.actual_timestamp_ms/1000+'秒',frame_verified:true,capture_method:f.capture_method,captured_at:checked_at,reviewed_by:'machine:independent-validator',review_note:'Adapter frame, hash and exact subtitle/POI agreement.'})),opinions:[{text:v.description,source_video:'https://www.bilibili.com/video/'+id.bvid+'/',seconds:line.from}],dishes:[]},review:{status:'approved',reviewed_by:'machine:independent-validator',reviewed_at:input.checked_at,rules_version:RULES,verification_id:verificationId,evidence_sha256:await sha(encode(evidence))}};
   if(!safe(record.creator.name)||!safe(record.video.title)){missing.push('unsafe_metadata');continue;}
   validate('record',record);records.push(record);documents.push({sha256:verificationId,bytes,document});
  }
  // Every proposed visit must satisfy the same checks; avoid silently dropping failed visits.
  if(missing.length)return pending(missing);
  if(new Set(records.map(visitKey)).size!==records.length)return pending(['duplicate_visit']);
  return {status:'approved',records,documents,missing:[]};
 }catch{return pending(['invalid_evidence']);}
}
module.exports={verifyExtraction,RULES};
