const http = require('node:http');
const {readFile} = require('node:fs/promises');
const {join} = require('node:path');
const {createHandler, mapParameters} = require('./amap-handler.cjs');

function createServer(options = {}) {
  if (typeof options === 'string') options = {serviceKey: options};
  const handle = createHandler({...options, readAsset: file => readFile(join(__dirname, file))});
  return http.createServer(async (req, res) => {
    const response = await handle(new Request(new URL(req.url, 'http://127.0.0.1'), {method: req.method}));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
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
