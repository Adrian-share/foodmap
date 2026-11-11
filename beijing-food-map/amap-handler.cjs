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
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options': 'nosniff'}});
}
function validPoint({lng, lat}) {
  return Number.isFinite(lng) && Number.isFinite(lat) && lng >= 115.4 && lng <= 117.6 && lat >= 39.4 && lat <= 41.1;
}
function text(value) { return typeof value === 'string' ? value : ''; }
function createHandler(options = {}) {
  // 保留旧原型 createServer(key) 的使用方式。
  if (typeof options === 'string') options = {serviceKey: options};
  const {serviceKey, jsKey, securityCode, request = fetch, readAsset} = options;
  const mapEnabled = Boolean(jsKey && securityCode);
  const state=options.contentState||require('../content/runtime.cjs');
  const content=require('../content/http.cjs').createContentHandler({readAsset,state});
  const nearby=require('../nearby.cjs').createNearbyService({mode:serviceKey?'live':'fixture',dataset:'verified',...options,contentCatalog:state.catalog});
  async function upstream(path, params, key, host = 'https://restapi.amap.com') {
    const url = new URL(path, host);
    url.search = new URLSearchParams(params);
    url.searchParams.set('key', key);
    // Workers does not implement redirect: 'error'; manual + !ok rejects redirects on both runtimes.
    const response = await request(url, {signal: AbortSignal.timeout(10000), redirect: 'manual'});
    if (!response.ok) throw Error('高德服务暂不可用');
    return response;
  }
  return async req => {
    try {
      if (req.method !== 'GET') return json({error:'只支持读取'}, 405);
      const url = new URL(req.url, 'http://127.0.0.1');
      const contentResponse=await content(req);
      if(contentResponse)return contentResponse;
      if(url.pathname==='/api/nearby'){
        const data=await nearby.query(Object.fromEntries(url.searchParams));
        const {withContentCard}=require('../content/presentation.cjs');
        return json({...data,results:data.results.map(s=>withContentCard(s,url.origin,state.images))});
      }
      const asset = Object.hasOwn(assets, url.pathname) && assets[url.pathname];
      if (asset) {
        const [file, type] = asset;
        return new Response(await readAsset(file), {headers: {'Content-Type':type + '; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}});
      }
      if (url.pathname === '/api/amap/status') return json({enabled: Boolean(serviceKey)});
      if (url.pathname === '/api/amap/config') return json({
        jsKey: jsKey || '', serviceHost: '/_AMapService', searchEnabled: Boolean(serviceKey), mapEnabled
      });
      if (url.pathname.startsWith('/_AMapService/')) {
        const path = url.pathname.slice('/_AMapService'.length);
        if (!/^\/v[345]\/[a-z0-9_/-]+$/i.test(path)) return json({error:'未找到代理地址'}, 404);
        if (!mapEnabled) return json({error:'高德 Web JS SDK 凭据未配置'}, 503);
        const params = new URLSearchParams(url.searchParams);
        params.set('jscode', securityCode);
        const host = path === '/v4/map/styles' || path.startsWith('/v4/map/styles/')
          ? 'https://webapi.amap.com' : 'https://restapi.amap.com';
        const response = await upstream(path, params, jsKey, host);
        return new Response(response.body, {headers: {'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store'}});
      }
      if (url.pathname === '/api/amap/search') {
        const input = normalize(url.searchParams.get('q') || '');
        if (!input || input.length > 80) return json({error:'请输入北京地点名称'}, 400);
        if (!serviceKey) return json({error:'高德 Web 服务凭据未配置'}, 503);
        const station = resolveFixture(input);
        const response = await upstream('/v5/place/text', {
          keywords: station ? station.name : input, region:'110000', city_limit:'true', page_size:'10'
        }, serviceKey);
        const result = await response.json();
        if (result.status !== '1' || !Array.isArray(result.pois)) return json({error:'高德地点搜索失败'}, 502);
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
        return json({matches: exact.length ? exact : matches});
      }
      // 保留静态图端点用于对照，不作为交互式地图降级冒充验收。
      if (url.pathname === '/api/amap/map') {
        const origin = {lng:Number(url.searchParams.get('lng')), lat:Number(url.searchParams.get('lat'))};
        if (!validPoint(origin)) return json({error:'起点坐标无效'}, 400);
        if (!serviceKey) return json({error:'高德 Web 服务凭据未配置'}, 503);
        const response = await upstream('/v3/staticmap', mapParameters([origin, ...closest(origin, restaurants)]), serviceKey);
        if (!response.headers.get('content-type')?.startsWith('image/png')) return json({error:'高德底图生成失败'}, 502);
        return new Response(response.body, {headers: {'Content-Type':'image/png', 'Cache-Control':'no-store'}});
      }
      return json({error:'未找到请求地址'}, 404);
    } catch {
      return json({error:'高德请求超时或服务暂不可用'}, 502);
    }
  };
}
module.exports = {createHandler, mapParameters};
