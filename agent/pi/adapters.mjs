import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runFile=promisify(execFile);
import httpIdentity from '../../content/http-identity.cjs';
import {imageInfo} from '../../content/publication.cjs';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const video=c=>'https://www.bilibili.com/video/'+c.bvid+'/';
function allowed(url,kind){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port)throw Error('invalid_source');const host=u.hostname;const valid=kind==='metadata'?host==='api.bilibili.com':kind==='subtitle'?/(^|\.)hdslb\.com$/.test(host):kind==='stream'?/(^|\.)bilivideo\.(com|cn)$/.test(host):kind==='poi'?u.origin==='https://foodmap.shareworld.fun'&&u.pathname==='/api/content/poi':false;if(!valid)throw Error('invalid_source');return u;}
export async function fetchBounded(url,kind,{signal,max=512*1024,request=fetch}={}){
 let u=allowed(url,kind);let response;
 for(let i=0;i<4;i++){response=await request(u,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{...httpIdentity,Referer:'https://www.bilibili.com/'}});if([301,302,303,307,308].includes(response.status)){u=allowed(new URL(response.headers.get('location'),u),kind);continue;}break;}
 if(!response?.ok)throw Error('source_unavailable');
 const reader=response.body.getReader();let length=0;const chunks=[];
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>max){await reader.cancel();throw Error('source_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 return Buffer.concat(chunks);
}
async function safeRoot(context){const actual=await fs.realpath(context.root);if((await fs.lstat(context.root)).isSymbolicLink()||actual!==path.resolve(context.root))throw Error('outside_evidence_root');return actual;}
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
 const data=JSON.parse(await fetchBounded(url,'metadata',{signal}));
 const page=data.data?.pages?.find(p=>p.page===context.part);
 if(data.code!==0||data.data?.bvid!==context.bvid||String(data.data?.owner?.mid)!==context.creator_uid||!page)throw Error('wrong_official_owner');
 const result=await register(context,'metadata','metadata',data,url);
 result.subtitles_status='not_requested';
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
 }
 return result;
}
export async function searchPoi(context,args,signal){
 try{const url='https://foodmap.shareworld.fun/api/content/poi?'+new URLSearchParams({q:args.query});const data=JSON.parse(await fetchBounded(url,'poi',{signal}));if(data.status!=='1'||!Array.isArray(data.pois))throw Error('poi_unavailable');return await register(context,'poi:'+sha(Buffer.from(args.query)).slice(0,16),'poi',data,'https://restapi.amap.com/v5/place/text');}catch{return {status:'pending',reason:'poi_source_unavailable'};}
}
export async function captureFrame(context,args,signal){
 try{
  // Inputs are BV/P/timestamp only. The signed stream URL comes from the official API.
  const meta=await metadata(context,{include_subtitles:false},signal),page=meta.payload.data.pages.find(p=>p.page===context.part);
  if(args.timestamp_ms<0||args.timestamp_ms>page.duration*1000)throw Error('timestamp_outside_video');
  const endpoint='https://api.bilibili.com/x/player/playurl?'+new URLSearchParams({bvid:context.bvid,cid:String(page.cid),qn:'16',fnval:'0',fnver:'0',fourk:'0'});
  const playable=JSON.parse(await fetchBounded(endpoint,'metadata',{signal}));
  if(playable.code!==0||playable.data?.is_preview||playable.data?.durl?.length!==1)throw Error('stream_unavailable');
  const url=allowed(playable.data.durl[0].url,'stream');
  const bytes=await fetchBounded(url,'stream',{signal,max:128*1024*1024});
  // Media bytes exist only in bounded memory and pipe:0. stdout is a single PNG.
  const ffmpeg=context.adapters?.ffmpeg||'/usr/local/bin/ffmpeg';
  if(!['/usr/local/bin/ffmpeg','/opt/homebrew/bin/ffmpeg'].includes(ffmpeg))throw Error('unapproved_encoder');
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','info','-protocol_whitelist','pipe','-i','pipe:0','-an','-vf',`select=gte(t\\,${args.timestamp_ms/1000}),showinfo,signalstats,metadata=print`,'-frames:v','1','-f','image2pipe','-vcodec','png','pipe:1'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(40000)]):AbortSignal.timeout(40000)});
  const output=[],logs=[];let outputSize=0,logSize=0;
  child.stdout.on('data',b=>{outputSize+=b.length;if(outputSize>8*1024*1024)child.kill();else output.push(b);});child.stderr.on('data',b=>{logSize+=b.length;if(logSize<=128*1024)logs.push(b);});child.stdin.on('error',()=>{});
  const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('capture_failed')));});
  child.stdin.end(bytes);await completion;
  const image=Buffer.concat(output),info=imageInfo(image,'image/png'),log=Buffer.concat(logs).toString();
  const actual=Number(log.match(/pts_time:([\d.]+)/)?.[1])*1000;
  // signalstats reports luma range; showinfo reports stdev before any scaling/cropping.
  const mean=Number(log.match(/mean:\[([\d.]+)/)?.[1]),stddev=Number(log.match(/stdev:\[([\d.]+)/)?.[1]);
  if(!Number.isFinite(actual)||Math.abs(actual-args.timestamp_ms)>1000||!Number.isFinite(mean)||mean<8||mean>247||!Number.isFinite(stddev)||stddev<8)throw Error('unusable_frame');
  await safeRoot(context);
  const hash=sha(image),file='frame-'+hash+'.png';await fs.writeFile(path.join(context.root,file),image,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  if((await fs.lstat(path.join(context.root,file))).isSymbolicLink()||sha(await fs.readFile(path.join(context.root,file)))!==hash)throw Error('frame_hash_mismatch');
  const payload={bvid:context.bvid,part:context.part,cid:page.cid,timestamp_ms:args.timestamp_ms,actual_timestamp_ms:Math.round(actual),sha256:hash,capture_method:'official-stream-pipe',mime_type:'image/png',bytes:image.length,...info,mean,stddev};
  const result=await register(context,'frame:'+args.timestamp_ms,'frame',payload,video(context));
  context.frame_files||={};context.frame_files[hash]={file,sha256:hash};
  let ocr=null;
  try{
   const native=await runFile(path.join(projectRoot,'tools/frame-ocr'),[path.join(context.root,file)],{timeout:15000,maxBuffer:128*1024,env:{PATH:'/usr/bin:/bin'},signal});
   const recognized=JSON.parse(native.stdout);if(recognized.engine!=='apple-vision-v1'||!Array.isArray(recognized.lines)||recognized.lines.length>1000)throw Error('invalid_ocr');
   ocr=await register(context,'ocr:'+args.timestamp_ms,'branch',{bvid:context.bvid,part:context.part,cid:page.cid,timestamp_ms:payload.actual_timestamp_ms,image_sha256:hash,...recognized},video(context));
  }catch{}
  return {...result,status:'captured',artifact_id:result.evidence_id,ocr};
 }catch(error){if(signal?.aborted)throw error;return {status:'blocked_capture',reason:'official_stream_or_frame_unavailable'};}
}
