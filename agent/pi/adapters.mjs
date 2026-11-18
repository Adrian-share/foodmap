import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runFile=promisify(execFile);
import {decodeFrameFromStream} from './stream-frame.mjs';
import {createModelPreview} from './model-preview.mjs';
import {readPublicPoi} from './public-http.mjs';
import httpIdentity from '../../content/http-identity.cjs';
import {imageInfo} from '../../content/publication.cjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const video=c=>'https://www.bilibili.com/video/'+c.bvid+'/';
function allowed(url,kind){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('invalid_source');const host=u.hostname;const valid=kind==='metadata'?host==='api.bilibili.com':kind==='subtitle'?/(^|\.)hdslb\.com$/.test(host):kind==='stream'?/(^|\.)bilivideo\.(com|cn)$/.test(host):kind==='poi'?u.origin==='https://foodmap.shareworld.fun'&&u.pathname==='/api/content/poi':false;if(!valid)throw Error('invalid_source');return u;}
export async function openAllowedResponse(url,kind,{signal,request=fetch,timeoutMs=15000}={}){
 let u=allowed(url,kind);let response;
 for(let i=0;i<4;i++){response=await request(u,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs),headers:{...httpIdentity,Referer:'https://www.bilibili.com/'}});if([301,302,303,307,308].includes(response.status)){u=allowed(new URL(response.headers.get('location'),u),kind);continue;}break;}
 if(!response?.ok)throw Error('source_unavailable');
 return response;
}
export async function fetchBounded(url,kind,{signal,max=512*1024,request=fetch}={}){
 const response=await openAllowedResponse(url,kind,{signal,request});
 const reader=response.body.getReader();let length=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error('source_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
async function safeRoot(context){const actual=await fs.realpath(context.root);if((await fs.lstat(context.root)).isSymbolicLink()||actual!==path.resolve(context.root))throw Error('outside_evidence_root');return actual;}
async function cachedBytes(file,hash,max){
 const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>max)throw Error('evidence_too_large');const raw=await handle.readFile();if(raw.length>max||sha(raw)!==hash)throw Error('evidence_hash_mismatch');return raw;}finally{await handle.close();}
}
async function registered(context,id){
 const e=context.evidence[id];if(!e)return null;
 if(!/^source-[a-f0-9]{64}\.json$/.test(e.file))throw Error('invalid_cached_source');
 const base=await safeRoot(context),file=path.join(base,e.file);
 if((await fs.lstat(file)).isSymbolicLink())throw Error('symlink_evidence');
 const raw=await cachedBytes(file,e.sha256,512*1024);
 return {evidence_id:id,kind:e.kind,sha256:e.sha256,payload:JSON.parse(raw),source_url:e.source_url};
}
export async function register(context,id,kind,payload,source_url){
 await safeRoot(context);
 const bytes=Buffer.from(JSON.stringify(payload));if(bytes.length>512*1024)throw Error('evidence_too_large');
 const filename='source-'+sha(bytes)+'.json';
 await fs.writeFile(path.join(context.root,filename),bytes,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
 if((await fs.lstat(path.join(context.root,filename))).isSymbolicLink()||sha(await fs.readFile(path.join(context.root,filename)))!==sha(bytes))throw Error('evidence_hash_mismatch');
 context.evidence[id]={file:filename,sha256:sha(bytes),kind,source_url,checked_at:new Date().toISOString()};
 return {evidence_id:id,kind,sha256:sha(bytes),payload,source_url};
}
export async function metadata(context,args,signal){
 const url='https://api.bilibili.com/x/web-interface/view?'+new URLSearchParams({bvid:context.bvid});
 const cached=await registered(context,'metadata');
 const fresh=cached&&cached.kind==='metadata'&&cached.source_url===url&&Date.now()-Date.parse(context.evidence.metadata.checked_at)<24*3600*1000&&Date.now()>=Date.parse(context.evidence.metadata.checked_at);
 const data=fresh?cached.payload:JSON.parse(await fetchBounded(url,'metadata',{signal}));
 const page=data.data?.pages?.find(p=>p.page===context.part);
 if(data.code!==0||data.data?.bvid!==context.bvid||String(data.data?.owner?.mid)!==context.creator_uid||!page)throw Error('wrong_official_owner');
 const result=fresh?cached:await register(context,'metadata','metadata',data,url);
 result.subtitles_status='not_requested';
 if(args.include_subtitles&&context.subtitles_checked){
  result.subtitles_status=context.subtitles_status||'source_unavailable';
  if(result.subtitles_status==='available'){
   const s=await registered(context,'subtitle');
   if(!s||s.kind!=='subtitle'||s.payload.bvid!==context.bvid||s.payload.part!==context.part||s.payload.cid!==page.cid)throw Error('cached_subtitle_identity_mismatch');
   result.subtitle=s;
  }
  return result;
 }
 if(args.include_subtitles){
  try{
   const playerUrl='https://api.bilibili.com/x/player/wbi/v2?'+new URLSearchParams({bvid:context.bvid,cid:page.cid});
   const player=JSON.parse(await fetchBounded(playerUrl,'metadata',{signal}));
   const subtitles=player.data?.subtitle?.subtitles;if(player.code!==0||!Array.isArray(subtitles))throw Error('subtitles_unavailable');
   const selected=subtitles.find(s=>s.lan==='zh-CN')||subtitles.find(s=>s.lan?.startsWith('ai-zh'))||subtitles[0];if(!selected?.subtitle_url)throw Error('subtitles_unavailable');
   const subtitleUrl=new URL(selected.subtitle_url,'https://api.bilibili.com').href;
   const body=JSON.parse(await fetchBounded(subtitleUrl,'subtitle',{signal}));
   if(!Array.isArray(body.body)||body.body.length>10000)throw Error('invalid_subtitles');
   const subtitle=await register(context,'subtitle','subtitle',{bvid:context.bvid,part:context.part,cid:page.cid,body:body.body},subtitleUrl);
   result.subtitles_status='available';result.subtitle=subtitle;
  }catch{result.subtitles_status='source_unavailable';}
  context.subtitles_checked=true;context.subtitles_status=result.subtitles_status;
 }
 return result;
}
export async function searchPoi(context,args,signal,{readPoi=readPublicPoi}={}){
 try{const data=await readPoi(args.query,signal);const result=await register(context,'poi:'+sha(Buffer.from(args.query)).slice(0,16),'poi',data,'https://restapi.amap.com/v5/place/text');return {...result,...(data._transport?{transport:data._transport}:{})};}
 catch(error){if(signal?.aborted)throw error;const code=/^public_[a-z0-9_]+$/.test(error.message)?error.message:'public_transport_failed';return {status:'pending_transport',reason:'poi_source_unavailable',error_code:code};}
}
export function playbackURL(bvid,cid,quality=64){if(![16,32,64].includes(quality))throw Error('invalid_quality');return 'https://api.bilibili.com/x/player/playurl?'+new URLSearchParams({bvid,cid:String(cid),qn:String(quality),fnval:'0',fnver:'0',fourk:'0'});}
export async function captureFrame(context,args,signal){
 try{
  // Inputs are BV/P/timestamp only. The signed stream URL comes from the official API.
  const meta=await metadata(context,{include_subtitles:false},signal),page=meta.payload.data.pages.find(p=>p.page===context.part);
  if(args.timestamp_ms<0||args.timestamp_ms>page.duration*1000)throw Error('timestamp_outside_video');
  const cached=await registered(context,'frame:'+args.timestamp_ms);
  if(cached&&cached.kind==='frame'&&cached.source_url===video(context)&&cached.payload.bvid===context.bvid&&cached.payload.part===context.part&&cached.payload.cid===page.cid&&cached.payload.timestamp_ms===args.timestamp_ms){
   const frame=cached.payload,entry=context.frame_files?.[frame.sha256];
   if(!entry||!/^frame-[a-f0-9]{64}\.png$/.test(entry.file))throw Error('cached_frame_missing');
   const file=path.join(await safeRoot(context),entry.file);if((await fs.lstat(file)).isSymbolicLink())throw Error('symlink_evidence');
   const bytes=await cachedBytes(file,frame.sha256,8*1024*1024);if(bytes.length!==frame.bytes||entry.sha256!==frame.sha256)throw Error('frame_hash_mismatch');
   const ocr=await registered(context,'ocr:'+args.timestamp_ms);
   if(ocr&&(ocr.kind!=='branch'||ocr.payload.bvid!==context.bvid||ocr.payload.part!==context.part||ocr.payload.cid!==page.cid||ocr.payload.image_sha256!==frame.sha256))throw Error('cached_ocr_identity_mismatch');
   return {...cached,status:'captured',artifact_id:cached.evidence_id,ocr,cache_hit:true,preview:null};
  }
  if((context.frame_capture_count||0)>=3)return {status:'pending_budget',reason:'frame_sampling_budget_exhausted'};
  context.frame_capture_count=(context.frame_capture_count||0)+1;
  if((context.model_preview_bytes||0)>=96*1024)return {status:'pending_budget',reason:'model_preview_budget_exhausted'};
  const requested_quality=context.adapters?.quality??64;
  const endpoint=playbackURL(context.bvid,page.cid,requested_quality);
  const playable=JSON.parse(await fetchBounded(endpoint,'metadata',{signal}));
  if(playable.code!==0||playable.data?.is_preview||playable.data?.durl?.length!==1)throw Error('stream_unavailable');
  const url=allowed(playable.data.durl[0].url,'stream');
  const ffmpeg=context.adapters?.ffmpeg||'/usr/local/bin/ffmpeg';
  if(!['/usr/local/bin/ffmpeg','/opt/homebrew/bin/ffmpeg'].includes(ffmpeg))throw Error('unapproved_encoder');
  const captureSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(40000)]):AbortSignal.timeout(40000);
  const response=await openAllowedResponse(url,'stream',{signal:captureSignal,timeoutMs:40000});
  const {image,log,downloaded_bytes}=await decodeFrameFromStream(response,args.timestamp_ms,ffmpeg,captureSignal);
  const info=imageInfo(image,'image/png');
  const actual=Number(log.match(/pts_time:([\d.]+)/)?.[1])*1000;
  // signalstats reports luma range; showinfo reports stdev before any scaling/cropping.
  const mean=Number(log.match(/mean:\[([\d.]+)/)?.[1]),stddev=Number(log.match(/stdev:\[([\d.]+)/)?.[1]);
  if(!Number.isFinite(actual)||Math.abs(actual-args.timestamp_ms)>1000||!Number.isFinite(mean)||mean<8||mean>247||!Number.isFinite(stddev)||stddev<8)throw Error('unusable_frame');
  await safeRoot(context);
  const hash=sha(image),file='frame-'+hash+'.png';await fs.writeFile(path.join(context.root,file),image,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  if((await fs.lstat(path.join(context.root,file))).isSymbolicLink()||sha(await fs.readFile(path.join(context.root,file)))!==hash)throw Error('frame_hash_mismatch');
  const payload={bvid:context.bvid,part:context.part,cid:page.cid,timestamp_ms:args.timestamp_ms,actual_timestamp_ms:Math.round(actual),sha256:hash,capture_method:'official-stream-pipe',mime_type:'image/png',bytes:image.length,...info,mean,stddev,downloaded_bytes,requested_quality,actual_quality:playable.data.quality};
  const result=await register(context,'frame:'+args.timestamp_ms,'frame',payload,video(context));
  context.frame_files||={};context.frame_files[hash]={file,sha256:hash};
  let ocr=null;
  try{
   const native=await runFile(path.join(projectRoot,'tools/frame-ocr'),[path.join(context.root,file)],{timeout:15000,maxBuffer:128*1024,env:{PATH:'/usr/bin:/bin'},signal});
   const recognized=JSON.parse(native.stdout);if(recognized.engine!=='apple-vision-v1'||!Array.isArray(recognized.lines)||recognized.lines.length>1000)throw Error('invalid_ocr');
   ocr=await register(context,'ocr:'+args.timestamp_ms,'branch',{bvid:context.bvid,part:context.part,cid:page.cid,timestamp_ms:payload.actual_timestamp_ms,image_sha256:hash,...recognized},video(context));
  }catch{}
  let preview=null;try{preview=await createModelPreview(context,image,hash,ffmpeg,signal);}catch(error){if(signal?.aborted)throw error;}
  return {...result,status:'captured',artifact_id:result.evidence_id,ocr,preview};
 }catch(error){if(signal?.aborted)throw error;const known=['source_unavailable','source_too_large','timestamp_outside_video','stream_unavailable','unusable_frame','invalid_image','invalid_source'];return {status:'blocked_capture',reason:'official_stream_or_frame_unavailable',error_code:known.includes(error.message)?error.message:error.name};}
}
