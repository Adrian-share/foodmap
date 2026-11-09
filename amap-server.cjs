const http = require('node:http');
const {readFile} = require('node:fs/promises');
const {join} = require('node:path');
const {closest, restaurants} = require('./samples.js');

const assets = {
  '/': ['index.html', 'text/html'],
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
function createServer(options = {}) {
  // 保留旧原型 createServer(key) 的使用方式。
  if (typeof options === 'string') options = {serviceKey: options};
  const {serviceKey, jsKey, securityCode, request = fetch} = options;
  const mapEnabled = Boolean(jsKey && securityCode);
  const {createNearbyService}=require('./nearby.cjs');
  const {createMcpHandler,decorate}=require('./mcp-server.cjs');
  const {imageForPath}=require('./images.cjs');
  const service=createNearbyService({...options,audit:options.audit||(()=>{})});
  const mcp=createMcpHandler({...options,service});
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
      const url = new URL(req.url, 'http://127.0.0.1');
      if(url.pathname==='/mcp')return mcp(req,res);
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,{error:'只支持读取'},405);
      if(url.pathname==='/health')return json(res,{status:'ok'});
      if(url.pathname.startsWith('/images/')){
        const image=imageForPath(url.pathname);if(!image)return json(res,{error:'未找到图片'},404);
        res.writeHead(200,{'Content-Type':'image/jpeg','Content-Length':image.bytes.length,'X-Content-Type-Options':'nosniff'});
        return res.end(req.method==='HEAD'?undefined:image.bytes);
      }
      if(url.pathname==='/api/nearby'){
        const data=await service.query(Object.fromEntries(url.searchParams));
        return json(res,decorate(data,options.publicBaseUrl||`http://${req.headers.host}`));
      }
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
        const input=url.searchParams.get('q')||'';
        if(!input||input.length>80)return json(res,{error:'请输入北京或上海地点名称'},400);
        if(!serviceKey)return json(res,{error:'高德 Web 服务凭据未配置'},503);
        const live=createNearbyService({...options,mode:'live'});
        const resolved=await live.resolve({location:input,city:url.searchParams.get('city')||undefined});
        return json(res,{matches:resolved.matches});
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
  const port = Number(process.env.PORT || 8767), host = process.env.HOST || '127.0.0.1';
  createServer({mode:process.env.LOCATION_MODE || 'fixture', dataset:process.env.DATASET || 'fixture',
    publicBaseUrl:process.env.PUBLIC_BASE_URL, serviceKey: process.env.AMAP_WEB_SERVICE_KEY, jsKey: process.env.AMAP_JS_KEY,
    securityCode: process.env.AMAP_JS_SECURITY_CODE}).listen(port, host, () => {
    console.log('探店地图 http://' + host + ':' + port + '/');
  });
}
module.exports = {createServer, mapParameters};
