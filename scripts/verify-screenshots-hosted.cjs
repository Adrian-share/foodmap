'use strict';
const {chromium}=require('@playwright/test');
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
(async()=>{
  const base=process.env.FOODMAP_DEPLOYMENT_URL||'https://shareworld-foodmap.yzxpg95.chatgpt.site';
  const out=process.env.FOODMAP_EVIDENCE_DIR||'evidence/screenshots/hosted';fs.mkdirSync(out,{recursive:true});
  const proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,u=proxy?new URL(proxy):null;
  const browser=await chromium.launch({headless:true,proxy:u?{server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}:undefined});
  const report={url:base,checked_at:new Date().toISOString(),shops:[],pages:[]};
  try{
    const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(20000);
    const catalogResponse=await context.request.get(base+'/api/home/catalog');assert.ok(catalogResponse.ok());const catalog=await catalogResponse.json();report.version=catalog.version;
    for(const shop of catalog.shops){
      assert.equal(shop.image?.kind,'video_screenshot',shop.name);assert.equal(shop.image.source,shop.video);
      const response=await context.request.get(new URL(shop.image.url,base).href);assert.ok(response.ok(),shop.name);
      assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),shop.image.sha256);
      const detail=await(await context.request.get(base+'/api/content?visit_id='+encodeURIComponent(shop.featured_visit_id))).json();assert.equal(detail.records.length,1);
      const record=detail.records[0];assert.equal(record.video.url,shop.video);assert.equal(record.video.part,shop.image.part);assert.equal(record.visit.screenshots[0].timestamp_ms,shop.image.timestamp_ms);
      report.shops.push({store_id:shop.id,name:shop.name,visit_id:shop.featured_visit_id,bvid:record.video.bvid,part:shop.image.part,timestamp_ms:shop.image.timestamp_ms,image_url:new URL(shop.image.url,base).href,sha256:shop.image.sha256,hash_and_detail_verified:true});
    }
    for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
      await page.setViewportSize(viewport);await page.goto(base+'/content/',{waitUntil:'domcontentloaded'});await page.locator('.card').first().waitFor();
      assert.equal(await page.locator('.card').count(),catalog.shops.length);assert.equal(await page.locator('.card img').count(),catalog.shops.length);
      for(const img of await page.locator('.card img').all()){await img.scrollIntoViewIfNeeded();await img.evaluate(i=>i.decode());assert.ok(await img.evaluate(i=>i.naturalWidth>0));}
      assert.equal(await page.locator('.card .placeholder').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/'+device+'-all-shops.png',fullPage:device==='desktop'});
      await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#query').fill('王府井地铁站');
      const pending=page.waitForResponse(r=>r.url().includes('/api/nearby?')&&decodeURIComponent(r.url()).includes('王府井'));
      await page.getByRole('button',{name:'查最近三家',exact:true}).click();const data=await(await pending).json();assert.equal(data.status,'ok');
      await page.waitForFunction(()=>document.querySelectorAll('#results>li img').length===3&&[...document.querySelectorAll('#results>li img')].every(i=>i.complete&&i.naturalWidth>0));
      await page.waitForFunction(()=>document.getElementById('map').dataset.ready==='true');
      assert.equal(await page.locator('#results [data-missing=true]').count(),0);await page.screenshot({path:out+'/'+device+'-home.png',fullPage:true});
      report.pages.push({device,all_images_decoded:true,home_images:3,map_ready:true,home_store_ids:data.results.map(s=>s.id)});
    }
    report.complete=true;
  }finally{fs.writeFileSync(out+'/verification.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
  console.log(JSON.stringify({complete:report.complete,shops:report.shops.length,pages:report.pages.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
