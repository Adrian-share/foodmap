import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../beijing-food-map/amap-handler.cjs';

test('同一个请求处理器在无 Node HTTP 和文件系统的环境返回页面及配置', async () => {
  const handle = handler.createHandler({readAsset: () => '<title>探店地图</title>'});
  const page = await handle(new Request('https://foodmap.example/'));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /探店地图/);
  const response = await handle(new Request('https://foodmap.example/api/amap/config'));
  assert.equal((await response.json()).mapEnabled, false);
});

test('托管环境不发布源码、配置文件或任意静态文件', async () => {
  const handle = handler.createHandler({readAsset: () => {throw Error('不应读取');}});
  for (const path of ['/.env', '/.openai/hosting.json', '/amap-handler.cjs', '/package.json']) {
    assert.equal((await handle(new Request('https://foodmap.example' + path))).status, 404);
  }
});

test('托管地图代理使用环境凭据且不信任浏览器传入的 key 与 jscode', async () => {
  let target;
  const handle = handler.createHandler({jsKey: 'test-public', securityCode: 'test-secret', request: async url => {
    target = new URL(url);
    return new Response('map-data');
  }});
  const result = await handle(new Request('https://foodmap.example/_AMapService/v3/log/init?key=other&jscode=other'));
  assert.equal(target.origin, 'https://restapi.amap.com');
  assert.equal(target.searchParams.get('jscode'), 'test-secret');
  assert.equal(target.searchParams.get('key'), 'test-public');
  assert.equal(await result.text(), 'map-data');
});

test('上游 HTTP 错误和异常在托管环境返回 502，不泄露密钥', async () => {
  for (const request of [async () => new Response('test-secret', {status: 403}), async () => {throw Error('test-secret');}]) {
    const handle = handler.createHandler({serviceKey: 'test-secret', request});
    const response = await handle(new Request('https://foodmap.example/api/amap/search?q=东坝'));
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('test-secret'));
  }
});

test('使用 Worker 支持的重定向策略，并拒绝把凭据请求跟随到其他地址', async () => {
  let calls = 0;
  const handle = handler.createHandler({serviceKey: 'test-secret', request: async (url, init) => {
    calls++;
    if (init.redirect === 'error') throw new TypeError('Workers 不支持该模式');
    assert.equal(init.redirect, 'manual');
    return new Response('', {status: 302, headers: {Location: 'https://other.example/'}});
  }});
  const response = await handle(new Request('https://foodmap.example/api/amap/search?q=东坝'));
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
});
