const {test, expect} = require('@playwright/test');
const {writeFileSync} = require('node:fs');
const {origins, restaurants} = require('../samples.js');
const expected = {
  王府井: ['富春居（北京璞瑄酒店店）', '泰丰楼', '北京宜宾招待所·餐厅'],
  东坝: ['寂川（西大望路店）', '潇湘阁（三里屯SOHO店）', '老吉堂·吉来（正大中心店）'],
  大钟寺: ['洪福亮酒家（南草厂街店）', '砂锅居（西四店）', '同和居（月坛店）']
};
const credentials = ['AMAP_WEB_SERVICE_KEY', 'AMAP_JS_KEY', 'AMAP_JS_SECURITY_CODE'];
for (const name of Object.keys(expected)) test(`真实高德地图：${name}`, async ({page}) => {
  test.skip(!process.env.FOODMAP_DEPLOYMENT_URL && credentials.some(key => !process.env[key]), '缺少高德凭据，真实地图验收待验证；不生成替代截图');
  await page.goto('/');
  await expect(page.locator('#map')).toHaveAttribute('data-ready', 'true');
  await page.getByLabel('起点', {exact: true}).fill(name);
  const searchResponse = page.waitForResponse(response => response.url().includes('/api/nearby?'));
  await page.getByRole('button', {name: '查最近三家', exact: true}).click();
  const result = await (await searchResponse).json();
  expect(result.status).toBe('ok');
  const origin = result.origin;
  await expect(page.locator('#status')).toContainText(name + '地铁站');
  await expect(page.locator('#map .map-pin')).toHaveCount(4);
  await expect(page.locator('#map [data-marker-index="0"]')).toHaveAttribute('aria-label', '起点 · ' + origin.name);
  const pins = page.locator('#map .map-pin');
  const bounds = await page.locator('#map').boundingBox();
  for (const pin of await pins.all()) {
    await expect(pin).toBeVisible();
    const box = await pin.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(bounds.x);
    expect(box.y).toBeGreaterThanOrEqual(bounds.y);
    expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
  }
  // 使用球面余弦公式独立复算实时点位；实现采用 Haversine。
  const rad = n => n * Math.PI / 180;
  const ranked = restaurants.map(shop => ({...shop, km: 6371 * Math.acos(Math.min(1,
    Math.sin(rad(origin.lat)) * Math.sin(rad(shop.lat)) + Math.cos(rad(origin.lat)) * Math.cos(rad(shop.lat)) * Math.cos(rad(shop.lng - origin.lng))))
  })).sort((a, b) => a.km - b.km).slice(0, 3);
  writeFileSync(`test-results/live-${name}.json`, JSON.stringify({origin, fixture: origins[name], ranked}, null, 2));
  expect(ranked.map(shop => shop.name)).toEqual(expected[name]);
  for (let i = 0; i < 3; i++) {
    const item = page.locator('#results > li').nth(i);
    await expect(item).toContainText(ranked[i].name);
    await expect(item).toContainText(ranked[i].km.toFixed(2) + ' km');
    const pin = page.locator(`#map [data-marker-index="${i + 1}"]`);
    await expect(pin).toHaveAttribute('aria-label', `${i + 1} · ${ranked[i].name}`);
    await pin.click();
    await expect(item).toHaveAttribute('aria-current', 'true');
    const info = page.locator('#map .shop-info:visible');
    await expect(info).toContainText(ranked[i].name);
    await expect(info).toContainText(ranked[i].address);
    await expect(info).toContainText(ranked[i].km.toFixed(2) + ' km');
    await expect(info.getByRole('link', {name: '探店记录'})).toHaveAttribute('href', '/content/?bvid=' + ranked[i].video.match(/BV[0-9A-Za-z]{10}/)[0]);
    if (i === 0) await page.screenshot({path: `test-results/live-${name}-detail.png`, fullPage: true});
    // 真实信息窗可能遮挡邻近图钉，使用页面提供的控件关闭后检查下一家。
    await page.getByRole('button', {name: '显示全部图钉'}).click();
    await expect(page.locator('#map .shop-info:visible')).toHaveCount(0);
  }
  // 关闭详情后重新适配视野，截图同时保留四个图钉及列表。
  await page.getByRole('button', {name: '显示全部图钉'}).click();
  await page.screenshot({path: `test-results/live-${name}.png`, fullPage: true});
});
