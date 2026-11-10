const {chromium}=require('@playwright/test');const fs=require('node:fs');
const batch=require('../content/batches/beijing-pilot-001.json');
(async()=>{
  const u=new URL(process.env.HTTPS_PROXY||process.env.HTTP_PROXY),browser=await chromium.launch({headless:true,proxy:{server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}});
  const results=[];
  try{
    for(const c of batch.inventory){
      const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(6000);
      const r={uid:c.uid,profile_url:c.profile_url,checked_at:new Date().toISOString(),reached_end:false};
      try{
        const response=await p.goto(c.profile_url+'/upload/video',{waitUntil:'domcontentloaded',timeout:20000});r.http_status=response.status();
        await p.waitForTimeout(2500);r.title=await p.title();r.visible_text=(await p.locator('body').innerText()).slice(0,7000);
        r.visible_video_links=await p.locator('a[href*="/video/BV"]').evaluateAll(a=>[...new Map(a.map(e=>[e.href,{url:e.href,title:e.innerText.trim()}])).values()].slice(0,50));
        r.stop_reason=r.visible_video_links.length?'仅记录首屏/第一页；未触发登录或人机校验。未宣称完整历史。':'未获得可盘点的视频列表，停止于官方主页入口。';
        await p.screenshot({path:`evidence/content/live/profile-${c.uid}.png`});
      }catch(e){r.error=e.name+': '+e.message.split('\n')[0];}
      finally{results.push(r);await p.close();fs.writeFileSync('content/sources/profile-inventory.json',JSON.stringify(results,null,2)+'\n');console.log(c.uid,r.http_status,r.visible_video_links?.length,r.title||r.error);}
    }
  }finally{await browser.close();}
})();
