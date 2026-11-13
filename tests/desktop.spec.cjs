const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const frozen=require('./fixtures/desktop-catalog.json');
async function setup(page){
  await page.route('**/api/amap/config',r=>r.fulfill({json:{jsKey:'fixture',serviceHost:'/_AMapService',mapEnabled:true,searchEnabled:false}}));
  await page.route('https://webapi.amap.com/maps?**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync('tests/mock-sdk.js','utf8')}));
  await page.goto('/');await expect(page.locator('#map')).toHaveAttribute('data-ready','true');
  await expect(page.locator('#current-origin')).toHaveText('王府井地铁站');
}
for(const width of [1280,1440])test(`U1/U2 ${width}: desktop layout, image fields, distance and two-way selection`,async({page})=>{
  await page.setViewportSize({width,height:960});await setup(page);
  const cards=page.locator('#results>li');await expect(cards).toHaveCount(6);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const map=await page.locator('.map-panel').boundingBox(),panel=await page.locator('.result-panel').boundingBox();expect(map.x+map.width).toBeLessThanOrEqual(panel.x);
  const input=await page.locator('#query').boundingBox(),filter=await page.locator('#creator-filter').boundingBox();expect(Math.abs(input.y-filter.y)).toBeLessThan(12);
  for(const c of await cards.all()){
    await expect(c.locator('.shop-select')).not.toBeEmpty();await expect(c.locator('.video-byline')).not.toBeEmpty();await expect(c.locator('.video-note')).not.toBeEmpty();
    const id=await c.getAttribute('data-store-id');expect(frozen.shops.some(s=>s.id===id)).toBe(true);
    await expect.poll(()=>c.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  }
  const distances=await cards.locator('.straight-distance').allTextContents();const values=distances.map(parseFloat);expect(values).toEqual([...values].sort((a,b)=>a-b));
  const card=cards.nth(5),id=await card.getAttribute('data-store-id');
  await page.locator(`#map .map-pin[data-store-id="${id}"]`).click();await expect(card).toHaveAttribute('aria-current','true');await expect(card).toBeInViewport();
  await cards.first().locator('.shop-select').click();await expect(page.locator('#map [data-marker-index="1"]')).toHaveAttribute('aria-pressed','true');await expect(card).toHaveAttribute('aria-current','false');
  await page.screenshot({path:`evidence/desktop/fixture-${width}.png`});
});
test('U3: append, filter and clear retain origin; Dongba updates results',async({page})=>{
  await setup(page);const first=await page.locator('#results>li').evaluateAll(xs=>xs.map(x=>x.dataset.storeId));
  await page.getByRole('button',{name:'查看更多',exact:true}).click();await expect(page.locator('#results>li')).toHaveCount(frozen.shops.length);
  const all=await page.locator('#results>li').evaluateAll(xs=>xs.map(x=>x.dataset.storeId));expect(new Set(all).size).toBe(all.length);expect(all.slice(0,6)).toEqual(first);
  await page.getByLabel('博主',{exact:true}).selectOption({label:'厨者王波'});await expect(page.locator('#results>li')).toHaveCount(2);await expect(page.locator('#current-origin')).toHaveText('王府井地铁站');
  await expect(page.locator('#results')).toContainText('厨者王波');await expect(page.locator('#map .map-pin')).toHaveCount(3);
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(page.locator('#results>li')).toHaveCount(6);
  await page.getByRole('button',{name:'东坝',exact:true}).click();await expect(page.locator('#current-origin')).toHaveText('东坝地铁站');await expect(page.locator('#results>li').first()).toContainText('寂川');
});
test('U4: exact visit opens in-site Bilibili player; empty state and image failure',async({page})=>{
  await setup(page);const card=page.locator('#results>li').first();const href=await card.locator('.detail-action').getAttribute('href');
  await card.locator('.detail-action').click();await expect(page.locator('#video-dialog')).toBeVisible();expect(page.url()).toContain(href);
  await page.route('https://player.bilibili.com/**',r=>r.fulfill({contentType:'text/html',body:'播放器替身：仅检查嵌入参数'}));
  await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();await expect(page.locator('#video-slot iframe')).toHaveAttribute('src',/player.bilibili.com\/player.html\?.*bvid=BV/);
  await page.goto('/');await page.locator('#query').fill('不存在的固定地点');await page.locator('#search button[type=submit]').click();await expect(page.locator('#empty-state')).toBeVisible();await expect(page.locator('#results>li')).toHaveCount(0);
  await page.route('**/content/images/**',r=>r.abort());await page.route('**/api/nearby?**',async r=>{const response=await r.fetch(),data=await response.json();for(const shop of data.results)if(shop.image)shop.image.url+='?test-failure=1';await r.fulfill({response,json:data});});await page.getByRole('button',{name:'王府井',exact:true}).click();await expect(page.locator('#results>li').first()).toContainText('截图待补');await expect(page.locator('#results>li').first().locator('.straight-distance')).toBeVisible();
});
