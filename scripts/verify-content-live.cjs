// 仅在浏览器内请求 B 站官方播放器。无视频下载、路由代理、响应体落盘或录屏。
const {chromium}=require('@playwright/test');
const fs=require('node:fs');
const {createServer}=require('../amap-server.cjs');
const batch=require('../content/batches/beijing-pilot-001.json');
(async()=>{
  const mobile=process.env.CONTENT_MOBILE==='1';
  const out=mobile?'evidence/content/live-mobile':'evidence/content/live';fs.mkdirSync(out,{recursive:true});
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
  const proxy=proxyUrl?(()=>{const u=new URL(proxyUrl);return {server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password),bypass:'127.0.0.1,localhost'};})():undefined;
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;
  let browser;
  const results=[];
  try{
    browser=await chromium.launch({headless:true,proxy,timeout:30000});
    for(const r of mobile?batch.records.slice(0,1):batch.records){
      const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:1000}});page.setDefaultTimeout(6000);
      const result={bvid:r.video.bvid,part:r.video.part,checked_at:new Date().toISOString(),official_player:null,site_origin:base,proxy_configured:!!proxy};
      try{
        await page.goto(base+'/content/?review=1',{waitUntil:'domcontentloaded',timeout:15000});
        await page.locator(`[data-bvid="${r.video.bvid}"] button`).click();
        const responsePromise=page.waitForResponse(x=>x.url().startsWith('https://player.bilibili.com/player.html'),{timeout:15000}).catch(()=>null);
        await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();
        const response=await responsePromise;result.player_http_status=response?.status()??null;
        await page.waitForTimeout(2500);
        result.official_player=await page.locator('iframe').getAttribute('src');
        const frame=page.frames().find(f=>f.url().startsWith('https://player.bilibili.com/'));
        result.frame_url=frame?.url()||null;
        if(frame){
          result.visible_text=(await frame.locator('body').innerText({timeout:6000}).catch(()=>'' )).slice(0,2500);
          if(await frame.locator('video').count()){
            result.before=await frame.locator('video').first().evaluate(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,readyState:v.readyState,paused:v.paused,error:v.error?.code??null}));
            await frame.locator('video').first().evaluate(v=>{v.muted=true;void v.play().catch(()=>{});});
            await page.waitForTimeout(2500);
            result.after=await frame.locator('video').first().evaluate(v=>({time:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,readyState:v.readyState,paused:v.paused,error:v.error?.code??null}));
          }
        }
        result.playback_verified=!!(result.after&&result.after.time>result.before.time+0.2&&result.after.readyState>=2);
        result.site_stayed=page.url().startsWith(base+'/content/');
        await page.screenshot({path:`${out}/${r.video.bvid}.png`,timeout:8000});
      }catch(e){result.error=e.name+': '+e.message.split('\n')[0];result.playback_verified=false;}
      finally{results.push(result);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');console.log(r.video.bvid,result.playback_verified?'PLAYING':'UNVERIFIED',result.player_http_status,result.visible_text?.slice(0,100)||result.error||'');await page.close();}
    }
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})();
