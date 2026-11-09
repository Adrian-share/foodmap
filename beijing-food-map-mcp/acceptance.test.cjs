const {test} = require('node:test');
const assert = require('node:assert/strict');
const {origins, restaurants, resolveFixture, closest} = require('./samples.js');

const expected = {
  '王府井': ['富春居', '泰丰楼', '北京宜宾招待所'],
  '东坝': ['寂川', '潇湘阁', '老吉堂'],
  '大钟寺': ['洪福亮酒家', '砂锅居', '同和居']
};

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

test('提交三个地名，离线页面均显示起点、三个图钉和三条结果', () => {
  const vm = require('node:vm');
  const {readFileSync} = require('node:fs');
  const {join} = require('node:path');

  class Element {
    constructor(tag = '') {
      this.tag = tag;
      this.children = [];
      this.listeners = {};
      this.namespaceURI = 'http://www.w3.org/2000/svg';
    }
    addEventListener(event, listener) { this.listeners[event] = listener; }
    replaceChildren(...items) { this.children = items; }
    append(...items) { this.children.push(...items); }
    setAttribute() {}
  }

  const ids = ['query', 'status', 'results', 'candidates', 'preview', 'map', 'search', 'connect'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  const document = {
    getElementById: id => elements[id],
    querySelectorAll: () => [],
    createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag)
  };
  const context = vm.createContext({document});
  for (const script of ['samples.js', 'prototype.js']) {
    vm.runInContext(readFileSync(join(__dirname, script), 'utf8'), context);
  }

  for (const input of ['望府井', '东坝', '大钟寺']) {
    elements.query.value = input;
    elements.search.listeners.submit({preventDefault() {}});
    assert.equal(elements.results.children.length, 3);
    const [svg] = elements.preview.children;
    assert.equal(svg.children.filter(node => node.tag === 'circle').length, 4);
  }
  elements.query.value = '未知位置';
  elements.search.listeners.submit({preventDefault() {}});
  assert.equal(elements.results.children.length, 0);
  assert.equal(elements.preview.children.length, 0);
});

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
