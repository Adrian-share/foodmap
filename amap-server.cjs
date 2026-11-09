const http = require('node:http');
const {readFile} = require('node:fs/promises');
const {join} = require('node:path');
const {closest, normalize, resolveFixture, restaurants} = require('./samples.js');

const assets = {
  '/': ['index.html', 'text/html'],
  '/samples.js': ['samples.js', 'text/javascript'],
  '/prototype.js': ['prototype.js', 'text/javascript']
};
function mapParameters(points) {
  return {size: '680*420', scale: '2', markers: points.map(({lng, lat}, index) =>
    (index ? 'mid,0x137664,' + index : 'mid,0x173D6B,S') + ':' + lng + ',' + lat).join('|')};
}
function json(res, data, status = 200) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(data));
}
function validPoint({lng, lat}) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 115.4 && lng <= 117.6 && lat >= 39.4 && lat <= 41.1;
}
function text(value) { return typeof value === 'string' ? value : ''; }
function createServer(options = {}) {
  // 保留旧原型 createServer(key) 的使用方式。
  if (typeof options === 'string') options = {serviceKey: options};
  const {serviceKey, jsKey, securityCode, request = fetch} = options;
  const mapEnabled = Boolean(jsKey && securityCode);
  async function upstream(path, params, key, host = 'https://restapi.amap.com') {
    const url = new URL(path, host);
    url.search = new URLSearchParams(params);
    url.searchParams.set('key', key);
    const response = await request(url, {signal: AbortSignal.timeout(10000), redirect: 'error'});
    if (!response.ok) throw Error('高德服务暂不可用');
    return response;
  }
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return json(res, {error:'只支持读取'}, 405);
      const url = new URL(req.url, 'http://127.0.0.1');
      const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
      if (asset) {
        const [file, type] = asset;
        const data = await readFile(join(__dirname, file));
        res.writeHead(200, {'Content-Type':type + '; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
        return res.end(data);
      }
      if (url.pathname === '/api/amap/status') return json(res, {enabled: Boolean(serviceKey)});
      if (url.pathname === '/api/amap/config') return json(res, {
        jsKey: jsKey || '', serviceHost: '/_AMapService', searchEnabled: Boolean(serviceKey), mapEnabled
      });
      if (url.pathname.startsWith('/_AMapService/')) {
        const path = url.pathname.slice('/_AMapService'.length);
        if (!/^\/v[345]\/[a-z0-9_/-]+$/i.test(path)) return json(res, {error:'未找到代理地址'}, 404);
        if (!mapEnabled) return json(res, {error:'高德 Web JS SDK 凭据未配置'}, 503);
        const params = new URLSearchParams(url.searchParams);
        params.set('jscode', securityCode);
        const host = path === '/v4/map/styles' || path.startsWith('/v4/map/styles/')
          ? 'https://webapi.amap.com' : 'https://restapi.amap.com';
        const response = await upstream(path, params, jsKey, host);
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(200, {'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store'});
        return res.end(body);
      }
      if (url.pathname === '/api/amap/search') {
        const input = normalize(url.searchParams.get('q') || '');
        if (!input || input.length > 80) return json(res, {error:'请输入北京地点名称'}, 400);
        if (!serviceKey) return json(res, {error:'高德 Web 服务凭据未配置'}, 503);
        const station = resolveFixture(input);
        const response = await upstream('/v5/place/text', {
          keywords: station ? station.name : input, region:'110000', city_limit:'true', page_size:'10'
        }, serviceKey);
        const result = await response.json();
        if (result.status !== '1' || !Array.isArray(result.pois)) return json(res, {error:'高德地点搜索失败'}, 502);
        const matches = result.pois.flatMap(poi => {
          const coordinates = text(poi.location).split(',');
          if (coordinates.length !== 2 || coordinates.some(value => !value.trim())) return [];
          const [lng, lat] = coordinates.map(Number);
          const name = text(poi.name);
          if (!name || !validPoint({lng, lat})) return [];
          return [{name: name.replace(/\(地铁站\)|（地铁站）/g, '地铁站'),
            address: [text(poi.adname), text(poi.address)].filter(Boolean).join(' · '), lng, lat, type: text(poi.typecode)}];
        });
        const exact = station ? matches.filter(poi => poi.type === '150500' && poi.name === station.name) : [];
        return json(res, {matches: exact.length ? exact : matches});
      }
      // 保留静态图端点用于对照，不作为交互式地图降级冒充验收。
      if (url.pathname === '/api/amap/map') {
        const origin = {lng:Number(url.searchParams.get('lng')), lat:Number(url.searchParams.get('lat'))};
        if (!validPoint(origin)) return json(res, {error:'起点坐标无效'}, 400);
        if (!serviceKey) return json(res, {error:'高德 Web 服务凭据未配置'}, 503);
        const response = await upstream('/v3/staticmap', mapParameters([origin, ...closest(origin, restaurants)]), serviceKey);
        if (!response.headers.get('content-type')?.startsWith('image/png')) return json(res, {error:'高德底图生成失败'}, 502);
        const image = Buffer.from(await response.arrayBuffer());
        res.writeHead(200, {'Content-Type':'image/png', 'Cache-Control':'no-store'});
        return res.end(image);
      }
      return json(res, {error:'未找到请求地址'}, 404);
    } catch {
      return json(res, {error:'高德请求超时或服务暂不可用'}, 502);
    }
  });
}
if (require.main === module) {
  const port = Number(process.env.PORT || 8766), host = process.env.HOST || '127.0.0.1';
  createServer({serviceKey: process.env.AMAP_WEB_SERVICE_KEY, jsKey: process.env.AMAP_JS_KEY,
    securityCode: process.env.AMAP_JS_SECURITY_CODE}).listen(port, host, () => {
    console.log('探店地图 http://' + host + ':' + port + '/');
  });
}
module.exports = {createServer, mapParameters};
