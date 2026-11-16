import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export const PREVIEW_LIMIT=24*1024,TASK_PREVIEW_LIMIT=96*1024;
export async function createModelPreview(context,png,sourceSha,ffmpeg,signal){
 if((context.model_preview_bytes||0)+PREVIEW_LIMIT>TASK_PREVIEW_LIMIT)return null;
 for(const [size,quality] of [[960,12],[720,22],[512,28]]){
  const pending=run(ffmpeg,['-hide_banner','-loglevel','error','-protocol_whitelist','pipe','-i','pipe:0','-vf',`scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease`,'-frames:v','1','-an','-q:v',String(quality),'-f','image2pipe','-vcodec','mjpeg','pipe:1'],{env:{PATH:'/usr/bin:/bin'},encoding:'buffer',maxBuffer:512*1024,timeout:10000,signal});
  pending.child.stdin.on('error',()=>{});pending.child.stdin.end(png);
  const {stdout:bytes}=await pending;
  if(bytes.length>PREVIEW_LIMIT)continue;
  const hash=sha(bytes),file='model-preview-'+hash+'.jpg';
  await fs.writeFile(path.join(context.root,file),bytes,{mode:0o600,flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  if((await fs.lstat(path.join(context.root,file))).isSymbolicLink()||sha(await fs.readFile(path.join(context.root,file)))!==hash)throw Error('preview_hash_mismatch');
  context.model_preview_bytes=(context.model_preview_bytes||0)+bytes.length;
  return {kind:'model_preview',file,sha256:hash,source_sha256:sourceSha,bytes:bytes.length,mime_type:'image/jpeg'};
 }
 return null;
}
export async function previewImageBlock(result,context){
 const p=result.preview;if(!p)return null;
 if(p.kind!=='model_preview'||p.source_sha256!==result.payload.sha256||p.bytes>PREVIEW_LIMIT||p.mime_type!=='image/jpeg')throw Error('invalid_model_preview');
 const base=await fs.realpath(context.root),file=path.resolve(base,p.file);
 if((await fs.lstat(context.root)).isSymbolicLink()||!file.startsWith(base+path.sep)||(await fs.lstat(file)).isSymbolicLink()||await fs.realpath(file)!==file)throw Error('outside_evidence_root');
 const bytes=await fs.readFile(file);if(bytes.length!==p.bytes||bytes.length>PREVIEW_LIMIT||sha(bytes)!==p.sha256)throw Error('preview_hash_mismatch');
 return {type:'image',mimeType:p.mime_type,data:bytes.toString('base64')};
}
