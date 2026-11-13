const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
const {fixture}=require('./fixtures/content.cjs');
const {visitKey}=require('../content/catalog.cjs');
for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  test(`${name}：托管首页读取新门店、同访图文、编号与精确详情`,async({page})=>{
    await page.setViewportSize(viewport);
    await page.route('https://webapi.amap.com/maps?**',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync('beijing-food-map/tests/mock-sdk.js','utf8')}));
    await page.route('https://player.bilibili.com/**',route=>route.fulfill({contentType:'text/html',body:'<p>播放器替身，仅验证分 P / 时间参数</p>'}));
    await page.goto('/');
    await page.locator('#query').fill('王府井');await page.getByRole('button',{name:'搜索附近',exact:true}).click();
    const card=page.locator('#results > li[data-store-id="amap:TEST-NEW"]');
    await expect(card).toBeVisible();await expect(card).toContainText('接口测试作者');await expect(card).toContainText('仅测试描述');await expect(card).toContainText('0.00 km');
    await expect(card.locator('img')).toBeVisible();expect(await card.locator('img').evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
    await expect(page.locator('#map .map-pin')).toHaveCount(7);
    const index=await card.evaluate(e=>Array.from(e.parentNode.children).indexOf(e)+1);
    await page.locator('#map [data-marker-index="'+index+'"]').click();await expect(card).toHaveAttribute('aria-current','true');
    const href=await card.getByRole('link',{name:'查看探店详情 →',exact:true}).getAttribute('href');expect(href).toContain('visit_id=');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    fs.mkdirSync('evidence/desktop/content-interface',{recursive:true});await page.screenshot({path:'evidence/desktop/content-interface/'+name+'-synthetic.png',fullPage:true});
    await card.getByRole('link',{name:'查看探店详情 →',exact:true}).click();await expect(page.locator('#video-dialog')).toBeVisible();await expect(page.locator('#video-title')).toContainText('TEST-NEW');
    await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();
    let player=new URL(await page.locator('iframe').getAttribute('src'));expect(player.searchParams.get('p')).toBe('1');expect(player.searchParams.get('t')).toBe('10');
    const other=fixture().batches[0].records[1];
    await page.goto('/content/?visit_id='+encodeURIComponent(visitKey(other)));await expect(page.locator('#video-title')).toContainText('TEST-BRANCH');
    await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();player=new URL(await page.locator('iframe').getAttribute('src'));expect(player.searchParams.get('p')).toBe('2');expect(player.searchParams.get('t')).toBe('50');
    await page.goto('/content/?bvid='+other.video.bvid);await expect(page.locator('#video-dialog')).not.toBeVisible();await expect(page.locator('.card')).toHaveCount(2);await expect(page.locator('#summary')).toContainText('多次到访');
    await page.goto('/content/?visit_id=withdrawn&bvid='+other.video.bvid);await expect(page.locator('#video-dialog')).not.toBeVisible();await expect(page.locator('#summary')).toContainText('已撤回');
    await page.goto('/content/?review=1');await expect(page.locator('.card')).toHaveCount(3);await expect(page.locator('.card img')).toHaveCount(3);await expect(page.locator('#summary')).toContainText('2 位 UP 主');
  });
}
