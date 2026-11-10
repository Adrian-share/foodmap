const {test,expect}=require('@playwright/test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const cases=[['北京王府井地铁站',['富春居','泰丰楼','北京宜宾招待所'],['1.72','1.92','2.82']],
  ['上海豫园地铁站',['上海老饭店','绿波廊','和平饭店龙凤厅'],['0.31','0.46','1.25']]];
async function setup(page){
  await page.route('**/api/amap/config',r=>r.fulfill({json:{jsKey:'fixture',serviceHost:'/_AMapService',mapEnabled:true}}));
  await page.route('https://webapi.amap.com/maps?**',r=>r.fulfill({contentType:'text/javascript',body:readFileSync(join(__dirname,'mock-sdk.js'),'utf8')}));
  await page.goto('/');await expect(page.locator('#map')).toHaveAttribute('data-ready','true');
}
for(const [location,names,km] of cases)test(`${location}：网页显示共享结果、图钉与原视频`,async({page})=>{
  await setup(page);await page.locator('#query').fill(location);
  const response=page.waitForResponse(r=>r.url().includes('/api/nearby?'));
  await page.getByRole('button',{name:'查最近三家',exact:true}).click();
  const data=await(await response).json();expect(data.status).toBe('ok');
  await expect(page.locator('#map .map-pin')).toHaveCount(4);
  await expect(page.locator('#status')).toContainText(data.origin.city);
  for(let i=0;i<3;i++){
    const li=page.locator('#results > li').nth(i);await expect(li).toContainText(names[i]);await expect(li).toContainText(km[i]+' km');
    await page.locator(`#map [data-marker-index="${i+1}"]`).click();
    const detail=page.locator('.shop-info');await expect(detail).toContainText(data.results[i].address);
    await expect(detail.getByRole('link',{name:'相关 B 站视频'})).toHaveAttribute('href','/content/?bvid='+data.results[i].video.match(/BV[0-9A-Za-z]{10}/)[0]);
    await page.getByRole('button',{name:'显示全部图钉'}).click();
  }
});
test('北京切上海：旧图钉、列表、详情同步清除',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'北京王府井',exact:true}).click();
  await expect(page.locator('#results')).toContainText('富春居');await page.locator('[data-marker-index="1"]').click();
  await page.getByRole('button',{name:'上海豫园',exact:true}).click();
  await expect(page.locator('#results')).toContainText('上海老饭店');await expect(page.locator('#results')).not.toContainText('富春居');
  await expect(page.locator('.shop-info')).toHaveCount(0);await expect(page.locator('#map .map-pin')).toHaveCount(4);
  expect(await page.evaluate(()=>window.sdkMap.markers.every(m=>m.position[0]>120))).toBe(true);
});
