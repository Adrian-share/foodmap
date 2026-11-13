const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const base=process.argv[2]||'https://shareworld-foodmap.yzxpg95.chatgpt.site';
const out='evidence/desktop/live';fs.mkdirSync(out,{recursive:true});
(async()=>{
  const value=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,u=value?new URL(value):null;
  const proxy=u?{server:u.protocol+'//'+u.host,username:decodeURIComponent(u.username),password:decodeURIComponent(u.password)}:undefined;
  const browser=await chromium.launch({headless:true,proxy});const results=[];
  try{
    for(const width of [1280,1440]){
      const context=await browser.newContext({viewport:{width,height:960},...(width===1440?{recordVideo:{dir:out,size:{width:1440,height:960}}}:{})});
      const page=await context.newPage();page.setDefaultTimeout(30000);
      const response=page.waitForResponse(r=>r.url().includes('/api/nearby?')&&r.status()===200);
      await page.goto(base,{waitUntil:'domcontentloaded'});const first=await(await response).json();
      await expect(page.locator('#current-origin')).toHaveText('王府井地铁站');
      await expect(page.locator('#map')).toHaveAttribute('data-ready','true');
      await expect(page.locator('#results>li')).toHaveCount(6);
      for(const img of await page.locator('#results img').all())await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
      assert.equal(first.origin.coordinate_source,'amap_live');
      assert.ok(first.results.every((s,i)=>!i||s.meters>=first.results[i-1].meters));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.screenshot({path:`${out}/wangfujing-${width}.png`});
      const result={width,origin:first.origin,version:first.data_version,total:first.total,initial:first.results.map(s=>({id:s.id,name:s.name,meters:s.meters,visit:s.featured_visit_id})),real_map:true};results.push(result);
      if(width===1440){
        await page.locator('#results>li').first().locator('.shop-select').click();await expect(page.locator('#map [data-marker-index="1"]')).toHaveAttribute('aria-pressed','true');
        const sixth=page.locator('#results>li').nth(5),id=await sixth.getAttribute('data-store-id');
        await page.getByRole('button',{name:'⌖ 显示全部图钉',exact:true}).click();
        await page.locator(`#map .map-pin[data-store-id="${id}"]`).click();await expect(sixth).toHaveAttribute('aria-current','true');await expect(sixth).toBeInViewport();
        await page.getByRole('button',{name:'查看更多',exact:true}).click();await expect(page.locator('#results>li')).toHaveCount(first.total);
        const ids=await page.locator('#results>li').evaluateAll(xs=>xs.map(x=>x.dataset.storeId));assert.equal(new Set(ids).size,ids.length);result.appended=ids.length;
        await page.getByLabel('博主',{exact:true}).selectOption({label:'厨者王波'});await expect(page.locator('#results>li')).toHaveCount(2);await expect(page.locator('#current-origin')).toHaveText('王府井地铁站');await expect(page.locator('#map .map-pin')).toHaveCount(3);
        result.filtered=await page.locator('#results>li').evaluateAll(xs=>xs.map(x=>({id:x.dataset.storeId,visit:x.dataset.visitId,text:x.innerText})));
        await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(page.locator('#results>li')).toHaveCount(6);
        await page.locator('#query').fill('东坝');await page.getByRole('button',{name:'搜索附近',exact:true}).click();await expect(page.locator('#current-origin')).toHaveText('东坝地铁站');await expect(page.locator('#results>li').first()).toContainText('寂川');
        result.dongba_first=await page.locator('#results>li').first().getAttribute('data-store-id');
        await page.getByRole('button',{name:'王府井',exact:true}).click();await expect(page.locator('#current-origin')).toHaveText('王府井地铁站');
        await page.getByLabel('博主',{exact:true}).selectOption({label:'厨者王波'});await expect(page.locator('#results>li')).toHaveCount(2);
        const card=page.locator('#results>li[data-store-id="amap:B0FFGCY5QP"]');
        await expect(card.locator('img')).toHaveAttribute('src',/BV1AdqYYNEDM/);
        await card.locator('.detail-action').click();await expect(page.locator('#video-dialog')).toBeVisible();await expect(page.locator('#video-source')).toContainText('BV1AdqYYNEDM');
        await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();
        const player=page.locator('#video-slot iframe'),src=await player.getAttribute('src');assert.equal(new URL(src).searchParams.get('bvid'),'BV1AdqYYNEDM');result.player_url=src;
        const video=page.frameLocator('#video-slot iframe').locator('video').first();await video.waitFor({state:'attached',timeout:30000});
        const before=await video.evaluate(v=>{v.muted=true;void v.play().catch(()=>{});return v.currentTime;});
        await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:30000}).toBeGreaterThan(before+.2);
        result.playback=await video.evaluate(v=>({time:v.currentTime,readyState:v.readyState,paused:v.paused}));
        await page.screenshot({path:`${out}/bilibili-playing.png`});
      }
      const video=page.video();await context.close();if(video)await video.saveAs(out+'/search-filter.webm');
      fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');
    }
  }finally{fs.writeFileSync(out+'/results.json',JSON.stringify(results,null,2)+'\n');await browser.close();}
  console.log(JSON.stringify({passed:true,widths:results.map(r=>r.width),playback:results[1].playback,output:out}));
})().catch(e=>{console.error(e);process.exitCode=1;});
