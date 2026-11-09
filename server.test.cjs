const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {createServer} = require('./amap-server.cjs');

async function server(t, options = {}) {
  const instance = createServer(options);
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(() => new Promise(resolve => instance.close(resolve)));
  const base = `http://127.0.0.1:${instance.address().port}`;
  return path => fetch(base + path);
}
const response = data => new Response(JSON.stringify(data), {headers: {'Content-Type': 'application/json'}});

test('公开配置只返回 JS key，不暴露安全密钥或 Web 服务 key', async t => {
  const get = await server(t, {serviceKey: 'private-service', jsKey: 'public-js', securityCode: 'private-security'});
  const config = await (await get('/api/amap/config')).json();
  assert.deepEqual(config, {jsKey: 'public-js', serviceHost: '/_AMapService', searchEnabled: true, mapEnabled: true});
  assert.ok(!JSON.stringify(config).includes('private'));
});
test('无凭据配置和状态接口可访问，搜索返回明确 503，未知地址 404', async t => {
  const get = await server(t);
  const config = await (await get('/api/amap/config')).json();
  assert.equal(config.mapEnabled, false);
  assert.equal(config.searchEnabled, false);
  assert.equal((await get('/api/amap/search?q=王府井')).status, 503);
  assert.equal((await get('/missing')).status, 404);
});
test('只有 JS key 而无安全密钥时不尝试加载地图', async t => {
  const get = await server(t, {jsKey: 'public-js'});
  assert.equal((await (await get('/api/amap/config')).json()).mapEnabled, false);
});
test('望府井归一化为王府井地铁站，只接受北京范围的正确站点', async t => {
  let requested;
  const get = await server(t, {serviceKey: 'service', request: async url => {
    requested = new URL(url);
    return response({status: '1', pois: [
      {name: '王府井商场', location: '116.41,39.91', typecode: '060100', adname: '东城区', address: '王府井大街'},
      {id: 'station', name: '王府井(地铁站)', location: '116.411571,39.908069', typecode: '150500', adname: '东城区', address: '地铁1号线'},
      {name: '外地同名站', location: '121.5,31.2', typecode: '150500'},
      {name: '坏坐标', location: 'NaN,39.9'}, {name: '空坐标', location: ''}
    ]});
  }});
  const {matches} = await (await get('/api/amap/search?q=北京望府井')).json();
  assert.equal(requested.searchParams.get('keywords'), '王府井地铁站');
  assert.equal(requested.searchParams.get('region'), '110000');
  assert.equal(requested.searchParams.get('city_limit'), 'true');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].name, '王府井地铁站');
  assert.equal(matches[0].lng, 116.411571);
  assert.match(matches[0].address, /东城区.*地铁1号线/);
});
test('同名同类型站点不任意取第一个，保留所有候选供页面选择', async t => {
  const get = await server(t, {serviceKey: 'service', request: async () => response({status: '1', pois: [
    {name: '王府井(地铁站)', location: '116.411571,39.908069', typecode: '150500', adname: '东城区', address: 'A口'},
    {name: '王府井(地铁站)', location: '116.412,39.908', typecode: '150500', adname: '东城区', address: 'B口'}
  ]})});
  assert.equal((await (await get('/api/amap/search?q=王府井')).json()).matches.length, 2);
});
test('空输入、长输入和超出北京的静态图坐标拒绝请求', async t => {
  const get = await server(t, {serviceKey: 'service', request: () => { throw Error('不应请求上游'); }});
  for (const path of ['/api/amap/search?q=', '/api/amap/search?q=' + 'a'.repeat(81),
    '/api/amap/map?lng=121.5&lat=31.2', '/api/amap/map?lng=NaN&lat=40']) {
    assert.equal((await get(path)).status, 400, path);
  }
});
test('上游鉴权错误和网络错误返回通用错误，不泄露密钥', async t => {
  for (const request of [async () => response({status: '0', info: 'private-security'}),
    async () => { throw Error('private-security'); }]) {
    const get = await server(t, {serviceKey: 'service', request});
    const result = await get('/api/amap/search?q=东坝');
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes('private-security'));
  }
});
test('SDK 代理把安全密钥加到服务端 URL，覆盖用户传来的密钥', async t => {
  let requested;
  const get = await server(t, {jsKey: 'public-js', securityCode: 'private-security', request: async url => {
    requested = new URL(url);
    return new Response('callback({"status":"1"})', {headers: {'Content-Type': 'application/javascript'}});
  }});
  const result = await get('/_AMapService/v3/log/init?key=attacker&jscode=attacker&callback=callback');
  assert.equal(result.status, 200);
  assert.equal(requested.origin, 'https://restapi.amap.com');
  assert.equal(requested.searchParams.get('key'), 'public-js');
  assert.equal(requested.searchParams.get('jscode'), 'private-security');
  assert.ok(!(await result.text()).includes('private-security'));
});
test('地图样式代理使用 webapi 域名，其他代理不接受任意目标', async t => {
  let requested;
  const get = await server(t, {jsKey: 'public-js', securityCode: 'private-security', request: async url => {
    requested = new URL(url); return response({ok: true});
  }});
  await get('/_AMapService/v4/map/styles?styleid=demo');
  assert.equal(requested.origin, 'https://webapi.amap.com');
  assert.equal(requested.pathname, '/v4/map/styles');
  assert.equal((await get('/_AMapService/https://example.com/')).status, 404);
  assert.equal((await get('/_AMapService/v3/%2Fexample')).status, 404);
});
