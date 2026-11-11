#!/usr/bin/env node
'use strict';
// Capture rendered frames in the official player; never download video bodies.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {parseArgs}=require('node:util');
const {assess,visitKey}=require('../content/catalog.cjs');
const root=path.resolve(__dirname,'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
function targets(city='北京'){
  const base=read(path.join(root,'data/catalog.json')),config=read(path.join(root,'content/config.json'));
  const legacy=base.visits.flatMap(v=>{
    const s=base.shops.find(s=>s.id===v.shop_id);
    if(!s||s.verification!=='verified'||s.city!==city||v.verification!=='baseline_accepted')return [];
    return [{visit_id:v.id,store_id:s.id,store_name:s.name,bvid:v.video.match(/BV[0-9A-Za-z]{10}/)[0],part:1,source_video:v.video,start_seconds:0,end_seconds:null,destination:'baseline'}];
  });
  const batches=config.batches.flatMap(e=>{
    if(e.enabled===false)return [];
    const b=read(path.join(root,'content',e.path));if(b.enabled===false)return [];
    return b.records.filter(r=>!assess(r,config).length&&r.visit.city.replace(/市$/,'')===city).map(r=>({visit_id:visitKey(r),store_id:config.store_aliases?.[r.visit.amap_poi_id]||'amap:'+r.visit.amap_poi_id,store_name:r.visit.store_name+'（'+r.visit.branch_name+'）',bvid:r.video.bvid,part:r.video.part,source_video:r.video.url,start_seconds:r.visit.start_seconds,end_seconds:r.visit.end_seconds,destination:e.path}));
  });
  return [...new Map([...legacy,...batches].map(t=>[t.visit_id,t])).values()];
}
function checkFrame(frame,target,bytes){
  for(const key of ['visit_id','store_id','bvid','part','source_video'])if(frame[key]!==target[key])throw Error('画面来源不匹配：'+key);
  const duration=frame.duration_seconds,t=frame.timestamp_ms/1000;
  if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(t)||t<target.start_seconds||t>Math.min(target.end_seconds??duration,duration)||!Number.isFinite(frame.current_seconds)||Math.abs(frame.current_seconds-t)>.1||!Number.isInteger(frame.readyState)||frame.readyState<2||!Number.isFinite(frame.video_width)||frame.video_width<=0||!Number.isFinite(frame.video_height)||frame.video_height<=0)throw Error('画面时间或解码状态无效');
  if(!/^[a-f0-9]{64}$/.test(frame.sha256)||hash(bytes)!==frame.sha256)throw Error('截图哈希不一致');
  if(bytes[0]!==255||bytes[1]!==216)throw Error('截图不是 JPEG');
}
async function capture(output,city,seconds,only,force=false){
  const {chromium}=require('@playwright/test'),file=path.join(output,'manifest.json');
  const manifest=fs.existsSync(file)?read(file):{schema_version:1,frames:[],failures:[]};
  if(Array.isArray(manifest))throw Error('旧版 manifest，请选择新的 --output 目录');
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,u=proxyUrl?new URL(proxyUrl):null;
  const browser=await chromium.launch({headless:true,...(u?{proxy:{server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}}:{})});
  try{
    const queue=targets(city).filter(t=>!only||t.bvid===only);
    if(only&&!queue.length)throw Error('未找到已收录的 BV');
    await Promise.all(Array.from({length:2},async()=>{
      while(queue.length){
        const target=queue.shift(),page=await browser.newPage({viewport:{width:960,height:540}});page.setDefaultTimeout(12000);
        try{
          await page.goto('https://player.bilibili.com/player.html?'+new URLSearchParams({bvid:target.bvid,p:String(target.part),autoplay:'0',danmaku:'0'}),{waitUntil:'domcontentloaded',timeout:30000});
          const video=page.locator('video').first();await video.waitFor();
          await video.evaluate(v=>{v.muted=true;void v.play().catch(()=>{});});
          await page.waitForFunction(()=>{const v=document.querySelector('video');return v&&v.readyState>=2&&Number.isFinite(v.duration)&&v.duration>0;},null,{timeout:20000});
          const duration=await video.evaluate(v=>v.duration),end=Math.min(target.end_seconds??duration,duration);
          const times=seconds||[.2,.45,.7].map(f=>Math.round((target.start_seconds+(end-target.start_seconds)*f)*10)/10);
          for(const t of times){
            if(t<target.start_seconds||t>=end)throw Error('选帧时间超出到访范围');
            const name=target.bvid+'-p'+target.part+'-'+Math.round(t*1000)+'.jpg',destination=path.join(output,name);
            const previous=manifest.frames.find(f=>f.visit_id===target.visit_id&&f.timestamp_ms===Math.round(t*1000));
            if(!force&&previous&&fs.existsSync(destination)&&hash(fs.readFileSync(destination))===previous.sha256){console.log(target.bvid,t,'cached');continue;}
            const actual=await video.evaluate(async(v,t)=>{
              v.pause();await new Promise((resolve,reject)=>{
                const timer=setTimeout(()=>{v.removeEventListener('seeked',done);reject(Error('seek timeout'));},15000);
                function done(){clearTimeout(timer);resolve();}
                v.addEventListener('seeked',done,{once:true});v.currentTime=t;
              });
              await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
              return {current_seconds:v.currentTime,readyState:v.readyState,video_width:v.videoWidth,video_height:v.videoHeight,duration_seconds:v.duration};
            },t);
            if(actual.readyState<2||Math.abs(actual.current_seconds-t)>.1)throw Error('定位画面失败');
            await page.setViewportSize(actual.video_height>actual.video_width?{width:540,height:960}:{width:960,height:540});
            // Hide HTML controls/recommendations only; the video pixels and embedded watermarks remain intact.
            await page.addStyleTag({content:'body * { visibility: hidden !important } video { visibility: visible !important }'});
            await page.mouse.move(0,0);await page.waitForTimeout(700);fs.mkdirSync(output,{recursive:true});
            const bytes=await video.screenshot({path:destination,type:'jpeg',quality:88});
            const frame={...target,...actual,timestamp_ms:Math.round(t*1000),file:name,sha256:hash(bytes),capture_method:'official-player-video-element',captured_at:new Date().toISOString()};checkFrame(frame,target,bytes);
            manifest.frames=manifest.frames.filter(f=>!(f.visit_id===target.visit_id&&f.timestamp_ms===frame.timestamp_ms));manifest.frames.push(frame);write(file,manifest);console.log(target.bvid,t,'captured');
          }
          manifest.failures=manifest.failures.filter(f=>f.visit_id!==target.visit_id);
        }catch(e){
          manifest.failures=manifest.failures.filter(f=>f.visit_id!==target.visit_id);
          manifest.failures.push({visit_id:target.visit_id,bvid:target.bvid,error:e.name,checked_at:new Date().toISOString()});console.error(target.bvid,'capture failed:',e.name);
        }finally{write(file,manifest);await page.close();}
      }
    }));
  }finally{await browser.close();}
  if(manifest.failures.length)process.exitCode=1;
  return manifest;
}
function apply(output,reviewFile,city){
  const manifest=read(path.join(output,'manifest.json')),review=read(reviewFile),current=targets(city);
  const registryFile=path.join(root,'content/baseline-screenshots.json'),registry=fs.existsSync(registryFile)?read(registryFile):[];
  const selected=new Set(),pending=[];
  // Validate the entire review before writing anything.
  for(const selection of review){
    if(selection.approved!==true||!selection.alt?.trim()||!selection.review_note?.trim()||!selection.reviewed_by?.trim())throw Error('缺少人工审核结论');
    if(selected.has(selection.visit_id))throw Error('同一次到访重复选帧');selected.add(selection.visit_id);
    const target=current.find(t=>t.visit_id===selection.visit_id),frame=manifest.frames.find(f=>f.visit_id===selection.visit_id&&f.file===selection.file&&f.sha256===selection.sha256);
    if(!target||!frame||!/^BV[0-9A-Za-z]{10}-p\d+-\d+\.jpg$/.test(frame.file))throw Error('无法匹配当前到访与采集帧');
    const bytes=fs.readFileSync(path.join(output,frame.file));checkFrame(frame,target,bytes);
    const screenshot={path:'content/images/'+frame.file,source_video:target.source_video,part:target.part,timestamp_ms:frame.timestamp_ms,sha256:frame.sha256,alt:selection.alt,frame_verified:true,capture_method:frame.capture_method,captured_at:frame.captured_at,reviewed_by:selection.reviewed_by,review_note:selection.review_note};
    pending.push({target,frame,bytes,screenshot});
  }
  const batches=new Map();
  for(const {target,frame,bytes,screenshot} of pending){
    fs.mkdirSync(path.join(root,'content/images'),{recursive:true});fs.writeFileSync(path.join(root,screenshot.path),bytes);
    if(target.destination==='baseline'){
      const entry={visit_id:target.visit_id,store_id:target.store_id,bvid:target.bvid,part:target.part,duration_seconds:frame.duration_seconds,screenshot};
      const index=registry.findIndex(e=>e.visit_id===target.visit_id);if(index<0)registry.push(entry);else registry[index]=entry;
    }else{
      const file=path.join(root,'content',target.destination),batch=batches.get(file)||read(file);
      batch.records.find(r=>visitKey(r)===target.visit_id).visit.screenshots=[screenshot];batches.set(file,batch);
    }
  }
  registry.sort((a,b)=>a.visit_id.localeCompare(b.visit_id));write(registryFile,registry);
  for(const [file,batch] of batches)write(file,batch);
  return {applied:pending.length,next:'npm run content:build'};
}
function gallery(output){
  const manifest=read(path.join(output,'manifest.json'));
  const safe=JSON.stringify(manifest.frames).replace(/</g,'\\u003c');
  const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>原视频截图审核</title>
<style>body{font:16px system-ui;margin:24px;background:#f5f4ef;color:#222}section{margin:24px 0;padding:16px;background:white}main{display:flex;flex-wrap:wrap;gap:16px}label{width:300px}img{display:block;width:300px;height:260px;object-fit:contain;background:#111}input[type=text]{display:block;width:min(95%,720px);margin:12px 0;padding:8px}button{padding:12px}small{display:block;overflow-wrap:anywhere}</style>
<h1>原视频截图审核</h1><p>逐帧确认主体清晰、不是黑帧、来源一致；保留视频内水印。选择每家一帧，填写客观描述和核对说明。未选中的帧不会入库。</p>
<input id="reviewer" type="text" placeholder="审核人 / agent 名称"><div id="groups"></div><button id="export">导出 review.json</button>
<script>
const frames=${safe},groups=document.getElementById('groups'),selections=[];
for(const id of [...new Set(frames.map(f=>f.visit_id))]){
 const list=frames.filter(f=>f.visit_id===id),section=document.createElement('section'),title=document.createElement('h2'),main=document.createElement('main');title.textContent=list[0].store_name;section.append(title,main);
 for(const f of list){const label=document.createElement('label'),radio=document.createElement('input'),img=document.createElement('img'),text=document.createElement('small');radio.type='radio';radio.name=id;img.src=f.file;text.textContent=f.bvid+' · P'+f.part+' · '+f.timestamp_ms/1000+' 秒';label.append(radio,img,text);main.append(label);radio.onchange=()=>section.frame=f;}
 for(const key of ['alt','review_note']){const input=document.createElement('input');input.type='text';input.placeholder=key==='alt'?'画面客观描述（不臆测菜名、价格或评价）':'核对说明：来源、时间、主体和水印';section[key]=input;section.append(input);}groups.append(section);selections.push(section);
}
document.getElementById('export').onclick=()=>{
 const reviewed_by=document.getElementById('reviewer').value.trim(),selected=selections.filter(s=>s.frame);
 if(!reviewed_by||!selected.length||selected.some(s=>!s.alt.value.trim()||!s.review_note.value.trim()))return alert('请填写审核人，并为选中的画面填写描述和核对说明');
 const result=selected.map(s=>({visit_id:s.frame.visit_id,file:s.frame.file,sha256:s.frame.sha256,approved:true,reviewed_by,alt:s.alt.value.trim(),review_note:s.review_note.value.trim()}));
 const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)+'\\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
</script></html>`;
  const file=path.join(output,'index.html');fs.writeFileSync(file,html);return {gallery:file,frames:manifest.frames.length,failures:manifest.failures};
}
async function main(){
  const {values:v,positionals}=parseArgs({allowPositionals:true,options:{output:{type:'string',default:'content/review-frames/screenshots'},city:{type:'string',default:'北京'},seconds:{type:'string'},bvid:{type:'string'},review:{type:'string'},force:{type:'boolean'},help:{type:'boolean'}}});
  const command=positionals[0]||'help',output=path.resolve(root,v.output);
  if(v.help||command==='help')return console.log('Usage: npm run screenshots -- plan|capture|gallery|apply [--city 北京] [--output content/review-frames/screenshots] [--bvid BV...] [--seconds 30,60] [--force] [--review review.json]\nSee docs/SCREENSHOTS.md. Capture is resumable; apply requires explicit visual review.');
  if(command==='plan')console.log(JSON.stringify(targets(v.city),null,2));
  else if(command==='gallery')console.log(JSON.stringify(gallery(output)));
  else if(command==='capture'){
    const seconds=v.seconds?.split(',').map(Number);if(seconds?.some(x=>!Number.isFinite(x)||x<0))throw Error('无效时间点');await capture(output,v.city,seconds,v.bvid,v.force);
  }else if(command==='apply'){
    if(!v.review)throw Error('apply 必须提供 --review');console.log(JSON.stringify(apply(output,path.resolve(v.review),v.city)));
  }else throw Error('未知命令：'+command);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={targets,checkFrame,apply,gallery,main};
