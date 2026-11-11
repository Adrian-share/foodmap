const {chromium}=require('@playwright/test');const fs=require('node:fs');const assert=require('node:assert/strict');
const expectedPublished=require('../content/catalog.cjs').publicRecords(require('../content/batches/beijing-pilot-001.json').records).length;
(async()=>{
  const base='https://shareworld-foodmap.yzxpg95.chatgpt.site',u=new URL(process.env.HTTPS_PROXY||process.env.HTTP_PROXY);
  const browser=await chromium.launch({headless:true,proxy:{server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}});
  const results=[];fs.mkdirSync('evidence/content/hosted',{recursive:true});
  try{
    for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
      const page=await browser.newPage({viewport});page.setDefaultTimeout(15000);
      const r={device,url:base+'/content/?review=1',checked_at:new Date().toISOString()};
      await page.goto(r.url,{waitUntil:'domcontentloaded'});await page.locator('.card').last().waitFor();
      r.candidate_count=await page.locator('.card').count();assert.equal(r.candidate_count,9);
      r.no_overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth);assert.ok(r.no_overflow);
      await page.screenshot({path:`evidence/content/hosted/${device}-cards.png`,fullPage:true});
      await page.locator('.card button').first().click();await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();
      const frame=await page.waitForEvent('framenavigated',{predicate:f=>f.url().startsWith('https://player.bilibili.com/player.html'),timeout:15000}).catch(()=>page.frames().find(f=>f.url().startsWith('https://player.bilibili.com/')));
      await frame.locator('video').first().waitFor({timeout:15000});await page.waitForTimeout(1500);
      const video=frame.locator('video').first();r.before=await video.evaluate(v=>({time:v.currentTime,paused:v.paused}));assert.equal(r.before.paused,true);
      await video.evaluate(v=>{v.muted=true;void v.play().catch(()=>{});});await page.waitForTimeout(4000);
      r.after=await video.evaluate(v=>({time:v.currentTime,paused:v.paused,readyState:v.readyState}));r.playback_verified=r.after.time>r.before.time+.2&&r.after.readyState>=2;assert.ok(r.playback_verified);
      r.site_stayed=new URL(page.url()).origin===base;assert.ok(r.site_stayed);await page.screenshot({path:`evidence/content/hosted/${device}-playing.png`});
      await page.getByRole('button',{name:'播放器无法播放',exact:true}).click();assert.ok((await page.locator('#video-status').innerText()).includes('原视频暂不可播放'));await page.screenshot({path:`evidence/content/hosted/${device}-fallback.png`});
      await page.getByRole('button',{name:'关闭视频'}).click();await page.goto(base+'/content/');await page.locator('#summary').filter({hasText:'已收录'}).waitFor();r.published_count=await page.locator('.card').count();assert.equal(r.published_count,expectedPublished);
      results.push(r);await page.close();
    }
    const p=await browser.newPage({viewport:{width:1440,height:1000}});
    await p.goto(base,{waitUntil:'domcontentloaded'});await p.locator('#query').fill('王府井');await p.getByRole('button',{name:'查最近三家',exact:true}).click();
    await p.locator('#results li').nth(2).waitFor();await p.waitForFunction(()=>document.getElementById('map').dataset.ready==='true',{},{timeout:20000});
    const text=await p.locator('#results').innerText();assert.ok(text.includes('富春居')&&text.includes('泰丰楼')&&text.includes('宜宾'));
    await p.screenshot({path:'evidence/content/hosted/beijing-map.png',fullPage:true});results.push({map_query:'王府井',real_map:true,results:text});await p.close();
  }finally{fs.writeFileSync('evidence/content/hosted/results.json',JSON.stringify(results,null,2)+'\n');await browser.close();}
  console.log(JSON.stringify(results,null,2));
})();
