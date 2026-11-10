const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
for(const [name,size] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  test(`${name}：九条候选、站内播放参数、失败保留出处`,async({page})=>{
    await page.setViewportSize(size);
    // 只验证自有界面的播放器协议与降级；真实播放由独立的联网记录验收。
    await page.route('https://player.bilibili.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><p>官方播放器测试替身 · 不代表真实播放成功</p>'}));
    await page.goto('/content/?review=1');await expect(page.locator('.card')).toHaveCount(9);
    await expect(page.locator('#review-note')).toBeVisible();await expect(page.locator('.card img')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.locator('.card button').first().click();await expect(page.locator('#video-dialog')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);await page.getByRole('button',{name:'在本站打开视频',exact:true}).click();
    const iframe=page.locator('#video-slot iframe'),u=new URL(await iframe.getAttribute('src'));
    expect(u.origin).toBe('https://player.bilibili.com');expect(u.searchParams.get('bvid')).toBe('BV1k1KN6BEvw');expect(u.searchParams.get('p')).toBe('1');expect(u.searchParams.get('autoplay')).toBe('0');
    await page.getByRole('button',{name:'播放器无法播放',exact:true}).click();await expect(page.locator('#video-status')).toContainText('原视频暂不可播放');await expect(page.locator('#video-source')).toContainText('BV1k1KN6BEvw');await expect(page.locator('iframe')).toHaveCount(0);
    fs.mkdirSync('evidence/content',{recursive:true});await page.screenshot({path:`evidence/content/${name}-fallback.png`,fullPage:true});
    await page.getByRole('button',{name:'关闭视频'}).click();await page.screenshot({path:`evidence/content/${name}-review-cards.png`,fullPage:true});
    await page.locator('#content-query').fill('厨者王波');await expect(page.locator('.card')).toHaveCount(3);
    await page.locator('#content-query').fill('BV1ao4y1k75R');await expect(page.locator('.card')).toHaveCount(1);
    await page.locator('#content-query').fill('不存在的店');await expect(page.locator('.empty')).toBeVisible();
  });
}
test('正式列表没有未准用卡片，旧门店原视频仍可在站内打开',async({page})=>{
  await page.goto('/content/');await expect(page.locator('.card')).toHaveCount(0);await expect(page.locator('.empty')).toBeVisible();
  await page.goto('/content/?bvid=BV1ka411n7Nd');await expect(page.locator('#video-dialog')).toBeVisible();await expect(page.locator('#video-source')).toContainText('BV1ka411n7Nd');expect(new URL(page.url()).pathname).toBe('/content/');
});
