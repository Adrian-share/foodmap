const {test, expect} = require('@playwright/test');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {origins, restaurants, resolveFixture} = require('../samples.js');
const expected = {
  王府井: {names: ['富春居（北京璞瑄酒店店）', '泰丰楼', '北京宜宾招待所·餐厅'], km: [1.72, 1.92, 2.82]},
  东坝: {names: ['寂川（西大望路店）', '潇湘阁（三里屯SOHO店）', '老吉堂·吉来（正大中心店）'], km: [8.11, 8.81, 8.93]},
  大钟寺: {names: ['洪福亮酒家（南草厂街店）', '砂锅居（西四店）', '同和居（月坛店）'], km: [3.74, 5.68, 5.85]}
};
const json = (route, value, status = 200) => route.fulfill({status, json: value});

async function setup(page) {
  await page.route('https://webapi.amap.com/maps?**', route => route.fulfill({
    contentType: 'text/javascript', body: readFileSync(join(__dirname, 'mock-sdk.js'), 'utf8')
  }));
  await page.route('**/api/amap/config', route => json(route, {
    jsKey: 'fixture-public-key', serviceHost: '/_AMapService', searchEnabled: true, mapEnabled: true
  }));
  await page.route('**/api/amap/status', route => json(route, {enabled: true}));
  await page.route('**/api/amap/search?**', route => {
    const input = new URL(route.request().url()).searchParams.get('q');
    const origin = resolveFixture(input);
    return json(route, {matches: origin ? [origin] : []});
  });
  await page.goto('/');
  await expect(page.locator('#map')).toBeVisible();
  await expect(page.locator('#results > li')).toHaveCount(3);
}
async function search(page, query) {
  await page.getByLabel('起点', {exact: true}).fill(query);
  await page.getByRole('button', {name: '查最近三家', exact: true}).click();
}
async function verify(page, name) {
  const {names, km} = expected[name];
  await expect(page.locator('#status')).toContainText(origins[name].name);
  const markers = page.locator('#map .map-pin');
  await expect(markers).toHaveCount(4);
  await expect(page.locator('#map [data-marker-index="0"]')).toContainText('起');
  const data = await page.evaluate(() => ({
    positions: window.sdkMap.markers.map(marker => marker.position), fitted: window.sdkMap.fitted
  }));
  expect(data.positions[0]).toEqual([origins[name].lng, origins[name].lat]);
  expect(data.fitted).toEqual(data.positions);
  for (let i = 0; i < 3; i++) {
    const shop = restaurants.find(item => item.name === names[i]);
    const item = page.locator('#results > li').nth(i);
    await expect(item).toContainText(names[i]);
    await expect(item).toContainText(shop.address);
    expect(Math.abs(Number((await item.innerText()).match(/([\d.]+) km/)[1]) - km[i])).toBeLessThanOrEqual(0.05);
    expect(data.positions[i + 1]).toEqual([shop.lng, shop.lat]);
    const pin = page.locator(`#map [data-marker-index="${i + 1}"]`);
    await expect(pin).toHaveText(String(i + 1));
    await pin.click();
    await expect(item).toHaveAttribute('aria-current', 'true');
    const info = page.locator('#map .shop-info');
    await expect(info).toContainText(shop.name);
    await expect(info).toContainText(shop.address);
    await expect(info).toContainText('km');
    await expect(info.getByRole('link', {name: '探店记录'})).toHaveAttribute('href', '/content/?bvid=' + shop.video.match(/BV[0-9A-Za-z]{10}/)[0]);
    await expect(item.getByRole('link', {name: '查看探店详情'})).toHaveAttribute('href', '/content/?bvid=' + shop.video.match(/BV[0-9A-Za-z]{10}/)[0]);
  }
}

for (const name of Object.keys(expected)) test(`${name}：同屏四个图钉、编号排序、分店地址距离与出处`, async ({page}) => {
  await setup(page);
  await search(page, name);
  await verify(page, name);
  await page.screenshot({path: `test-results/fixture-${name}.png`, fullPage: true});
});
test('望府井纠错与切换起点清除旧图钉及详情', async ({page}) => {
  await setup(page);
  await search(page, ' 北京望府井 ');
  await verify(page, '王府井');
  await search(page, '东坝');
  await expect(page.locator('#map .shop-info')).toHaveCount(0);
  await verify(page, '东坝');
  await expect(page.locator('#results')).not.toContainText('富春居');
});
test('旧请求晚返回时只保留最新起点', async ({page}) => {
  await setup(page);
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let arrived;
  const started = new Promise(resolve => { arrived = resolve; });
  await page.route('**/api/amap/search?**', async route => {
    const input = new URL(route.request().url()).searchParams.get('q');
    if (input === '王府井') { arrived(); await held; }
    await json(route, {matches: [origins[input]]});
  });
  await search(page, '王府井');
  await started;
  await search(page, '东坝');
  await verify(page, '东坝');
  const late = page.waitForResponse(response => response.url().includes('q=%E7%8E%8B'));
  release();
  await late;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await verify(page, '东坝');
});
test('歧义地点先选择再绘图，地址可区分', async ({page}) => {
  await setup(page);
  await page.route('**/api/amap/search?**', route => json(route, {matches: [
    {...origins.王府井, name: '同名地点', address: '东城区 王府井大街'},
    {...origins.大钟寺, name: '同名地点', address: '海淀区 大钟寺路'}
  ]}));
  await search(page, '同名地点');
  await expect(page.locator('#results > li')).toHaveCount(0);
  await expect(page.locator('#map .map-pin')).toHaveCount(0);
  await page.getByRole('button', {name: '同名地点 · 海淀区 大钟寺路'}).click();
  await expect(page.locator('#results > li').first()).toContainText('洪福亮酒家');
  await expect(page.locator('#map .map-pin')).toHaveCount(4);
});
test('无结果、接口失败清空旧结果，可重新搜索', async ({page}) => {
  await setup(page);
  await search(page, '没有这个地方');
  await expect(page.locator('#status')).toContainText('未找到');
  await expect(page.locator('#map .map-pin')).toHaveCount(0);
  await expect(page.locator('#results > li')).toHaveCount(0);
  await page.route('**/api/amap/search?**', route => json(route, {error: '失败'}, 502));
  await search(page, '东坝');
  await expect(page.locator('#status')).toContainText('失败');
  await expect(page.locator('#map .map-pin')).toHaveCount(0);
  await expect(page.locator('#results > li')).toHaveCount(0);
  await page.unroute('**/api/amap/search?**');
  await page.route('**/api/amap/search?**', route => json(route, {matches: [origins.大钟寺]}));
  await page.getByRole('button', {name: '重试搜索'}).click();
  await verify(page, '大钟寺');
});
test('高德脚本失败明确提示并可重试连接', async ({page}) => {
  await page.route('**/api/amap/config', route => json(route, {
    jsKey: 'fixture-public-key', serviceHost: '/_AMapService', searchEnabled: true, mapEnabled: true
  }));
  await page.route('**/api/amap/search?**', route => json(route, {matches: [origins.王府井]}));
  await page.route('https://webapi.amap.com/maps?**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#map-status')).toContainText('失败');
  await page.unroute('https://webapi.amap.com/maps?**');
  await page.route('https://webapi.amap.com/maps?**', route => route.fulfill({
    contentType: 'text/javascript', body: readFileSync(join(__dirname, 'mock-sdk.js'), 'utf8')
  }));
  await page.getByRole('button', {name: '重试地图'}).click();
  await expect(page.locator('#map .map-pin')).toHaveCount(4);
});
test('缺少凭据明确展示离线状态，未知起点不残留', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('#map-status')).toContainText('待验证');
  await expect(page.locator('#results > li')).toHaveCount(3);
  await search(page, '未知位置');
  await expect(page.locator('#results > li')).toHaveCount(0);
  await expect(page.locator('#preview .map-pin')).toHaveCount(0);
});
