// Operational preflight: only real registered evidence, no fixture or media files.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {metadata,searchPoi} from '../agent/pi/adapters.mjs';
import {createModelPreview,previewImageBlock} from '../agent/pi/model-preview.mjs';
const [file,archiveFile]=process.argv.slice(2),context=JSON.parse(await fs.readFile(file,'utf8'));
const archive=JSON.parse(await fs.readFile(archiveFile,'utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(context.bvid!==archive.bvid||context.creator_uid!==archive.creator_uid||context.part!==archive.part)throw Error('archive_identity_mismatch');
const signal=AbortSignal.timeout(45000);
const meta=await metadata(context,{include_subtitles:false},signal);
const page=meta.payload.data.pages.find(p=>p.page===context.part);
const frameEntry=archive.evidence['frame:2000'],ocrEntry=archive.evidence['ocr:2000'];
for(const [id,entry] of [['frame:2000',frameEntry],['ocr:2000',ocrEntry]]){
 const bytes=await fs.readFile(path.join(archive.root,entry.file));if(hash(bytes)!==entry.sha256)throw Error('archive_hash_mismatch');
 const payload=JSON.parse(bytes);if(payload.cid!==page.cid||payload.bvid!==context.bvid||payload.part!==context.part)throw Error('archive_page_mismatch');
 await fs.writeFile(path.join(context.root,entry.file),bytes,{mode:0o600});context.evidence[id]=entry;
}
const frame=JSON.parse(await fs.readFile(path.join(context.root,frameEntry.file),'utf8'));
const imageEntry=archive.frame_files[frame.sha256],image=await fs.readFile(path.join(archive.root,imageEntry.file));
if(image.length!==frame.bytes||hash(image)!==frame.sha256)throw Error('original_frame_hash_mismatch');
await fs.writeFile(path.join(context.root,imageEntry.file),image,{mode:0o600});context.frame_files={[frame.sha256]:imageEntry};
const poi=await searchPoi(context,{query:'曲廊院',city:'北京'},signal);
if(poi.status==='pending_transport')throw Error(poi.error_code);
const preview=await createModelPreview(context,image,frame.sha256,'/usr/local/bin/ffmpeg',signal);
const block=await previewImageBlock({preview,payload:frame},context);context.images=block?[block]:[];
context.prompt={task_id:context.task_id,creator_uid:context.creator_uid,bvid:context.bvid,part:context.part,evidence_ids:Object.keys(context.evidence),
 instruction:'Read the registered REAL official metadata, original frame at 2000ms and AMap response. The attached image is only a bounded preview; frame:2000 is the original evidence. C2 v2 permits an official description explicitly binding one venue to a distinguishing street plus this original frame and a unique Beijing AMap street match. Independently inspect all candidates, exclude different streets; do not choose the first result. Describe the store using ONE exact short quote from the official Bili description, not imagined speech/OCR. House number/address and GCJ-02 are from AMap only. Use actual payload.pois[].id for poi_candidates and registered artifact IDs for evidence_ids. Submit one extraction with screenshot_ids=[frame:2000], actual metadata P/CID, valid visit segment containing 2000ms. Do not sample more frames: existing original is enough to propose, missing facts stay missing. You cannot approve or publish.'};
await fs.writeFile(file,JSON.stringify(context,null,2),{mode:0o600});
console.log(JSON.stringify({bvid:context.bvid,cid:page.cid,metadata_sha256:meta.sha256,original_sha256:frame.sha256,poi_sha256:poi.sha256,preview_bytes:preview?.bytes}));
