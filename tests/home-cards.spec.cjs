const {test,expect}=require('@playwright/test');const {readFileSync}=require('node:fs');const {join}=require('node:path');
const origin={name:'安立路地铁站',address:'朝阳区 · 15号线',lng:116.407845,lat:40.002619,type:'150500'};
async function setup(page){
  await page.route('**/api/amap/config',r=>r.fulfill({json:{jsKey:'fixture',serviceHost:'/_AMapService',mapEnabled:true,searchEnabled:true}}));
  await page.route('https://webapi.amap.com/maps?**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(join(__dirname,'mock-sdk.js'),'utf8')}));
  await page.goto('/');
  await page.locator('#query').fill('安立路地铁站');await page.getByRole('button',{name:'查最近三家',exact:true}).click();await expect(page.locator('#map')).toHaveAttribute('data-ready','true');await expect(page.locator('body')).toHaveAttribute('data-catalog-version',/2026-11-11/);
}
for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  test(`A02/A03 ${device}：正常首页搜索显示新分店的图文卡和一致编号`,async({page})=>{
    await page.setViewportSize(viewport);await setup(page);
    const card=page.locator('#results>li').first();await expect(card).toHaveAttribute('data-store-id','amap:B0FFGCY5QP');
    await expect(card).toContainText('蓉亭食贝');await expect(card).toContainText('厨者王波');await expect(card).toContainText('肉丝');await expect(card.locator('.straight-distance')).toContainText(/0\.6\d km/);
    const img=card.locator('img');await expect(img).toBeVisible();await expect.poll(()=>img.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);await expect(img).toHaveAttribute('src',/\/content\/images\/BV1AdqYYNEDM-p1-30000\.png$/);
    await expect(card.locator('.pin-number')).toHaveText('1');expect(await page.evaluate(()=>window.sdkMap.markers[1].position)).toEqual([116.413218,40.006234]);
    await expect(card.getByRole('link')).toHaveCount(1);await expect(card.getByRole('link')).toHaveAttribute('href',/visit_id=BV1AdqYYNEDM/);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`evidence/home-cards/${device}-fixture.png`,fullPage:true});
    await card.getByRole('link').click();await expect(page.locator('#video-dialog')).toBeVisible();await expect(page.locator('#video-source')).toContainText('BV1AdqYYNEDM');
  });
}
test('A04 图片加载失败与无图门店都保留名称距离并显示截图待补',async({page})=>{
  await page.route('**/content/images/BV1AdqYYNEDM-p1-30000.png',r=>r.abort());await setup(page);
  const first=page.locator('#results>li').first();await expect(first).toContainText('截图待补');await expect(first).toContainText('蓉亭食贝');await expect(first.locator('.straight-distance')).toBeVisible();
  const second=page.locator('#results>li').nth(1);await expect(second).toContainText('截图待补');await expect(second.locator('.straight-distance')).toBeVisible();
});
