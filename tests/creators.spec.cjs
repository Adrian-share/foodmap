const {test,expect}=require('@playwright/test');
const fs=require('node:fs');const state=require('../content/runtime.cjs');
const wangbo=state.ledger.creators.find(c=>c.uid==='3546728118618546');
test('C2 匿名页面先登录，伪造浏览器身份头无法访问Node后台',async({request})=>{
 const r=await request.get('http://127.0.0.1:18914/admin/creators/?uid=3546728118618546',{maxRedirects:0});expect(r.status()).toBe(302);expect(r.headers().location).toContain('/signin-with-chatgpt?returnTo=');
 const api=await request.get('http://127.0.0.1:18914/api/admin/creators',{headers:{'oai-authenticated-user-id':'spoof'}});expect(api.status()).toBe(401);
});
test('C1/C2 已登录台账：王波61条明细、待核原因和候选样例',async({page})=>{
 await page.goto('/admin/creators/');await expect(page.locator('tbody tr')).toHaveCount(17);
 await page.getByRole('link',{name:'厨者王波',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(61);await expect(page.locator('#account')).toContainText('5780378');await expect(page.locator('#account')).toContainText('访问受限');
 await page.getByLabel('审核状态').selectOption('pending');await expect(page.locator('tbody tr')).toHaveCount(wangbo.counts.pending);await expect(page.locator('tbody tr').first()).toContainText('待核');
 await page.getByLabel('搜索视频').fill('BV1NG6kYTEXG');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('tbody tr')).toContainText('分店');
 fs.mkdirSync('evidence/admin/local',{recursive:true});await page.screenshot({path:'evidence/admin/local/wangbo-pending.png',fullPage:true});
 await page.goto('/admin/creators/?uid=79980672');await expect(page.locator('tbody tr')).toHaveCount(1);await expect(page.locator('#account')).toContainText('候选名单');await expect(page.locator('tbody')).toContainText('BV1GsmYBwEpz');
});
for(const size of [{width:1440,height:1000},{width:390,height:844}])test('C4 公开合集、站内播放及地图定位 '+size.width,async({page})=>{
 await page.setViewportSize(size);await page.route('https://player.bilibili.com/**',r=>r.fulfill({body:'播放器协议测试替身，不代表真实播放成功',contentType:'text/html'}));
 await page.goto('/');await page.getByRole('link',{name:'博主',exact:true}).click();await expect(page.locator('.creator')).toHaveCount(state.ledger.creators.filter(c=>c.counts.published).length);
 await page.getByRole('link',{name:/厨者王波/}).click();await expect(page.locator('.video-card')).toHaveCount(wangbo.counts.published);
 const expected=state.ledger.videos.filter(v=>v.creator_uid===wangbo.uid&&v.status==='published').map(v=>v.bvid);expect(await page.locator('.video-card').evaluateAll(xs=>xs.map(x=>x.dataset.bvid))).toEqual(expected);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'在本站播放',exact:true}).first().click();await expect(page.locator('#player')).toBeVisible();expect(new URL(await page.locator('iframe').getAttribute('src')).searchParams.get('bvid')).toBe(expected[0]);await page.getByRole('button',{name:'关闭播放器'}).click();await expect(page.locator('iframe')).toHaveCount(0);
 await page.screenshot({path:'evidence/admin/local/collection-'+size.width+'.png',fullPage:true});
 const map=page.getByRole('link',{name:'地图位置 ↗'}).first(),href=await map.getAttribute('href'),id=new URL(href,'http://test').searchParams.get('store_id');await map.click();await expect(page.locator('#results>li[aria-current="true"]')).toHaveAttribute('data-store-id',id);
});
