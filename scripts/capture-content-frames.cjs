// 浏览器对官方播放器渲染的 video 元素截图；绝不读取/保存视频响应体。
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto');
const batch=require('../content/batches/beijing-pilot-001.json');
(async()=>{
  const u=new URL(process.env.HTTPS_PROXY||process.env.HTTP_PROXY),proxy={server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)};
  const browser=await chromium.launch({headless:true,proxy});const manifest=[];
  fs.mkdirSync('content/review-frames',{recursive:true});
  try{
    for(const r of batch.records){
      const p=await browser.newPage({viewport:{width:720,height:1280}});p.setDefaultTimeout(8000);
      try{
        await p.goto('https://player.bilibili.com/player.html?'+new URLSearchParams({bvid:r.video.bvid,p:'1',autoplay:'0',danmaku:'0'}),{waitUntil:'domcontentloaded',timeout:20000});
        const video=p.locator('video').first();await video.waitFor({timeout:12000});
        await video.evaluate(v=>{v.muted=true;void v.play().catch(()=>{});});await p.waitForTimeout(1500);
        for(const seconds of [5,15,r.video.duration_seconds-3]){
          const actual=await video.evaluate(async(v,t)=>{
            v.pause();v.currentTime=t;
            await Promise.race([new Promise(resolve=>v.addEventListener('seeked',resolve,{once:true})),new Promise(resolve=>setTimeout(resolve,7000))]);
            return {current_seconds:v.currentTime,readyState:v.readyState,video_width:v.videoWidth,video_height:v.videoHeight};
          },seconds);
          if(actual.readyState<2||Math.abs(actual.current_seconds-seconds)>.1)throw Error('定位画面失败');
          await p.mouse.move(0,0);await p.waitForTimeout(500);
          const file=`content/review-frames/${r.video.bvid}-p1-${seconds*1000}.png`;
          await video.screenshot({path:file,timeout:8000});
          manifest.push({bvid:r.video.bvid,part:1,timestamp_ms:seconds*1000,path:file,source_video:r.video.url,capture_method:'浏览器对官方播放器 video 元素截图',...actual,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),rights_status:'pending',usage_basis:null,checked_at:new Date().toISOString()});
          console.log(r.video.bvid,seconds,'captured');
        }
      }catch(e){console.log(r.video.bvid,e.name,e.message.split('\n')[0]);}
      finally{fs.writeFileSync('content/review-frames/manifest.json',JSON.stringify(manifest,null,2)+'\n');await p.close();}
    }
  }finally{await browser.close();}
})();
