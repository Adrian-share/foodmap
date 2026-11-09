import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {origins} = createRequire(import.meta.url)('../beijing-food-map/samples.js');

const base = new URL(process.argv[2] || process.env.FOODMAP_DEPLOYMENT_URL || '');
assert.equal(base.protocol, 'https:', '部署验收必须验证 HTTPS');
const checks = [];
async function get(path, status = 200, options = {}) {
  const response = await fetch(new URL(path, base), {...options, signal: AbortSignal.timeout(25000), redirect: 'error'});
  assert.equal(response.status, status, path);
  checks.push({path, status: response.status});
  return response;
}
const health = await (await get('/healthz')).json();
assert.equal(health.status, 'ok');
assert.equal(health.application, 'beijing-food-map');
const page = await (await get('/')).text();
assert.match(page, /北京探店|北京附近探店|探店地图/);
await Promise.all(['/samples.js', '/prototype.js'].map(async path => {
  const result = await get(path);
  assert.match(result.headers.get('content-type'), /javascript/);
}));
const config = await (await get('/api/amap/config')).json();
assert.equal(config.mapEnabled, true, '托管地图凭据未配置');
assert.equal(config.searchEnabled, true, '托管搜索凭据未配置');
assert.deepEqual(Object.keys(config).sort(), ['jsKey', 'mapEnabled', 'searchEnabled', 'serviceHost'].sort());
await Promise.all(['王府井', '东坝', '大钟寺'].map(async name => {
  const {matches} = await (await get('/api/amap/search?' + new URLSearchParams({q: name}))).json();
  assert.equal(matches.length, 1, name);
  assert.equal(matches[0].name, name + '地铁站');
  assert.ok(Math.abs(matches[0].lng - origins[name].lng) < 0.001, name + ' 经度');
  assert.ok(Math.abs(matches[0].lat - origins[name].lat) < 0.001, name + ' 纬度');
}));
await Promise.all(['/.env', '/.openai/hosting.json', '/amap-handler.cjs', '/missing'].map(path => get(path, 404)));
await get('/api/amap/search', 405, {method: 'POST'});
console.log(JSON.stringify({url: base.origin, release: health.release, result: 'passed', checks}, null, 2));
