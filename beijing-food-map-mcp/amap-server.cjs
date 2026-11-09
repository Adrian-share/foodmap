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
  return {
    size: '680*420',
    scale: '2',
    markers: points.map(({lng, lat}, index) =>
      (index ? 'mid,0x137664,' + index : 'mid,0x173D6B,S') + ':' + lng + ',' + lat).join('|')
  };
}

async function amap(path, params, key) {
  const url = new URL(path, 'https://restapi.amap.com');
  url.search = new URLSearchParams({...params, key});
  const response = await fetch(url, {signal:AbortSignal.timeout(10000), redirect:'error'});
  if (!response.ok) throw new Error('高德服务暂不可用');
  return response;
}

function json(res, data, status = 200) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}

function validPoint({lng, lat}) {
  return lng >= 115.4 && lng <= 117.6 && lat >= 39.4 && lat <= 41.1;
}

function createServer(key) {
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') return json(res, {error:'只支持读取'}, 405);
      const url = new URL(req.url, 'http://127.0.0.1');
      const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
      if (asset) {
        const [file, type] = asset;
        res.writeHead(200, {'Content-Type':type + '; charset=utf-8', 'Cache-Control':'no-store'});
        return res.end(await readFile(join(__dirname, file)));
      }
      if (url.pathname === '/api/amap/status') return json(res, {enabled:Boolean(key)});
      if (!key) return json(res, {error:'本机高德服务未配置'}, 503);
      if (url.pathname === '/api/amap/search') {
        const input = normalize(url.searchParams.get('q') || '');
        if (!input || input.length > 80) return json(res, {error:'请输入北京地点名称'}, 400);
        const station = resolveFixture(input);
        const response = await amap('/v5/place/text', {
          keywords:station ? station.name : input,
          region:'110000', city_limit:'true', page_size:'10'
        }, key);
        const result = await response.json();
        if (result.status !== '1') return json(res, {error:'高德地点搜索失败'}, 502);
        const matches = (result.pois || []).flatMap(poi => {
          const [lng, lat] = (poi.location || '').split(',').map(Number);
          return validPoint({lng, lat}) ? [{name:poi.name, address:poi.adname, lng, lat, type:poi.typecode}] : [];
        });
        const exact = station && matches.find(poi => poi.type === '150500'
          && poi.name.replace(/[()（）]/g, '') === station.name);
        return json(res, {matches:exact ? [exact] : matches});
      }
      if (url.pathname === '/api/amap/map') {
        const origin = {lng:Number(url.searchParams.get('lng')), lat:Number(url.searchParams.get('lat'))};
        if (!validPoint(origin)) return json(res, {error:'起点坐标无效'}, 400);
        const response = await amap('/v3/staticmap', mapParameters([origin, ...closest(origin, restaurants)]), key);
        if (!response.headers.get('content-type')?.startsWith('image/png')) {
          return json(res, {error:'高德底图生成失败'}, 502);
        }
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
  const port = Number(process.env.PORT || 8766);
  createServer(process.env.AMAP_WEB_SERVICE_KEY).listen(port, '127.0.0.1', () => {
    console.log('探店地图 http://127.0.0.1:' + port + '/');
  });
}

module.exports = {mapParameters};
