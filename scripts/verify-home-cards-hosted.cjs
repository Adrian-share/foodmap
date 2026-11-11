const {chromium}=require('@playwright/test');const fs=require('node:fs');const assert=require('node:assert/strict');
// 用球面余弦独立复算，避免依赖首页的 Haversine 排序函数。
const airDistance=(a,b)=>{const rad=n=>n*Math.PI/180;return 6371000*Math.acos(Math.min(1,Math.sin(rad(a.lat))*Math.sin(rad(b.lat))+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.cos(rad(a.lng-b.lng))));};
(async()=>{
  const base=process.env.FOODMAP_DEPLOYMENT_URL||'https://shareworld-foodmap.yzxpg95.chatgpt.site',proxy=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,u=proxy?new URL(proxy):null;
  const browser=await chromium.launch({headless:true,proxy:u?{server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}:undefined});
  const out=process.env.FOODMAP_EVIDENCE_DIR||'evidence/home-cards/hosted';fs.mkdirSync(out,{recursive:true});const results=[];
  try{
    for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
      const p=await browser.newPage({viewport});p.setDefaultTimeout(20000);
      await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.body.dataset.catalogVersion?.includes('beijing-pilot-001.2026-11-11.2'));
      const catalog=await p.evaluate(async()=>await(await fetch('/api/home/catalog')).json());assert.equal(catalog.shops.length,11);
      const shop=catalog.shops.find(s=>s.id==='amap:B0FFGCY5QP');assert.ok(shop);
      const response=p.waitForResponse(r=>r.url().includes('/api/nearby?')&&decodeURIComponent(r.url()).includes('安立路'));
      await p.locator('#query').fill('安立路地铁站');await p.getByRole('button',{name:'查最近三家',exact:true}).click();
      const geo=await(await response).json();assert.equal(geo.status,'ok');
      const card=p.locator('#results>li').first();await card.locator('img').waitFor();await p.waitForFunction(()=>{const i=document.querySelector('#results>li img');return i?.complete&&i.naturalWidth>0;});
      assert.equal(await card.getAttribute('data-store-id'),shop.id);const text=await card.innerText();assert.ok(text.includes('厨者王波')&&text.includes('肉丝')&&text.includes('嫩'));
      const distance=Number((await card.locator('.straight-distance').innerText()).split(' ')[0]);assert.ok(Math.abs(distance-airDistance(geo.origin,shop)/1000)<.005);
      await p.waitForFunction(()=>document.getElementById('map').dataset.ready==='true');
      const marker=p.locator('#map [data-marker-index="1"]');assert.equal(await marker.getAttribute('data-store-id'),shop.id);assert.equal(await marker.innerText(),'1');
      assert.equal(await card.getByRole('link').count(),1);assert.ok(await card.locator('img').getAttribute('src').then(x=>x.includes('BV1AdqYYNEDM-p1-30000.png')));
      const r={device,url:p.url(),viewport,checked_at:new Date().toISOString(),catalog_version:catalog.version,data_version:geo.data_version,shop_count:catalog.shops.length,origin:geo.origin,store_id:shop.id,bvid:shop.visits[0].bvid,screenshot_timestamp_ms:shop.image.timestamp_ms,distance_km:distance,card_text:text,image:await card.locator('img').evaluate(i=>({src:i.getAttribute('src'),naturalWidth:i.naturalWidth,naturalHeight:i.naturalHeight})),marker_number:1,real_map:true,store_response:shop};
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await p.screenshot({path:`${out}/${device}-home.png`,fullPage:true});
      if(device==='mobile'){await card.scrollIntoViewIfNeeded();await p.screenshot({path:`${out}/mobile-card.png`});}
      assert.ok((await card.getByRole('link').getAttribute('href')).includes('visit_id='));await card.getByRole('link').click();await p.locator('#video-dialog[open]').waitFor();assert.equal(new URL(p.url()).origin,base);assert.ok((await p.locator('#video-source').innerText()).includes(r.bvid));
      await p.getByRole('button',{name:'在本站打开视频',exact:true}).click();
      const frameUrl=await p.locator('#video-slot iframe').getAttribute('src');assert.equal(new URL(frameUrl).searchParams.get('bvid'),r.bvid);assert.equal(new URL(frameUrl).searchParams.get('p'),'1');assert.equal(new URL(frameUrl).searchParams.get('autoplay'),'0');r.player_url=frameUrl;
      await p.waitForTimeout(2500);const frame=p.frames().find(f=>f.url().startsWith('https://player.bilibili.com/player.html'));
      if(frame&&await frame.locator('video').count()){
        const v=frame.locator('video').first();r.before=await v.evaluate(v=>({time:v.currentTime,paused:v.paused}));await v.evaluate(v=>{v.muted=true;void v.play().catch(()=>{});});await p.waitForTimeout(3000);r.after=await v.evaluate(v=>({time:v.currentTime,readyState:v.readyState}));r.playing=r.after.time>r.before.time+.2&&r.after.readyState>=2;
      }
      await p.screenshot({path:`${out}/${device}-detail.png`});results.push(r);fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');await p.close();
    }
    const p=await browser.newPage({viewport:{width:1440,height:1000}});await p.route('**/content/images/BV1AdqYYNEDM-p1-30000.png',r=>r.abort());
    await p.goto(base,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.body.dataset.catalogVersion);await p.locator('#query').fill('安立路地铁站');await p.getByRole('button',{name:'查最近三家',exact:true}).click();
    await p.locator('[data-store-id="amap:B0FFGCY5QP"] .frame-slot[data-missing=true]').waitFor();const text=await p.locator('#results>li').first().innerText();assert.ok(text.includes('截图待补')&&text.includes('km'));
    await p.screenshot({path:out+'/failed-image.png',fullPage:true});results.push({image_failure_fallback:true,text});await p.close();
  }finally{fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');await browser.close();}
  console.log(JSON.stringify(results,null,2));
})();
