const {test} = require('node:test');
const assert = require('node:assert/strict');
const {origins, restaurants, resolveFixture, closest} = require('./samples.js');

const expected = {
  '王府井': ['富春居', '泰丰楼', '北京宜宾招待所'],
  '东坝': ['寂川', '潇湘阁', '老吉堂'],
  '大钟寺': ['洪福亮酒家', '砂锅居', '同和居']
};

test('三个固定起点的距离与验收基准误差不超过 0.05 km', () => {
  const distances = {'王府井': [1.72, 1.92, 2.82], '东坝': [8.11, 8.81, 8.93], '大钟寺': [3.74, 5.68, 5.85]};
  for (const [name, km] of Object.entries(distances)) {
    closest(origins[name], restaurants).forEach((shop, index) =>
      assert.ok(Math.abs(shop.meters / 1000 - km[index]) <= 0.05, name + ' ' + shop.name));
  }
});

test('样本有十个不同的门店，均有地址、坐标和来源', () => {
  assert.equal(restaurants.length, 10);
  assert.equal(new Set(restaurants.map(shop => shop.name)).size, 10);
  for (const shop of restaurants) {
    assert.ok(shop.address && Number.isFinite(shop.lng) && Number.isFinite(shop.lat));
    assert.match(shop.source, /^https:\/\/tanwei\.org\/nearby\/poi\//);
  }
});

for (const [name, names] of Object.entries(expected)) {
  test(name + '定位到地铁站并选出最近三家', () => {
    const origin = resolveFixture(name);
    assert.equal(origin, origins[name]);
    assert.match(origin.name, /地铁站/);
    const shops = closest(origin, restaurants);
    assert.equal(shops.length, 3);
    shops.forEach((shop, index) => assert.ok(shop.name.startsWith(names[index]), shop.name));
    assert.ok(shops.every((shop, index) => index === 0 || shop.meters >= shops[index - 1].meters));
  });
}

test('识别王府井的口述误写，未知地点不回退到旧结果', () => {
  assert.equal(resolveFixture(' 北京望府井 '), origins['王府井']);
  assert.equal(resolveFixture('未知位置'), undefined);
});

// 原同步 VM 页面用例由 tests/page.spec.cjs 与双城浏览器端到端用例覆盖。

test('高德静态底图请求包含一个起点和三个依序编号的门店', () => {
  const {mapParameters} = require('./amap-server.cjs');
  const origin = origins['东坝'];
  const shops = closest(origin, restaurants);
  const params = mapParameters([origin, ...shops]);
  const markers = params.markers.split('|');
  assert.equal(markers.length, 4);
  assert.match(markers[0], /^mid,0x173D6B,S:116.547126,39.965732$/);
  shops.forEach((shop, index) => {
    assert.equal(markers[index + 1], 'mid,0x137664,' + (index + 1) + ':' + shop.lng + ',' + shop.lat);
  });
});
