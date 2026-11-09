const http = require('node:http');
const {McpServer} = require('@modelcontextprotocol/server');
const {NodeStreamableHTTPServerTransport, localhostHostValidation, localhostOriginValidation} = require('@modelcontextprotocol/node');
const {z} = require('zod');
const {resolveFixture, closest, restaurants} = require('./samples.js');
const {withImage, imageForPath, caption, imageContent} = require('./images.cjs');

const instructions = '你是北京探店助手。用户没有明确提供位置（例如只问“我附近有什么？”）时，先追问酒店、地铁站或地标，等用户补充后才调用 find_nearby_food。禁止猜位置、用默认起点、IP、设备定位或跨会话记忆。用户补充位置后再查询。成功时告诉用户解析后的起点、样本坐标来源、最近三家完整分店名、直线距离、每家探店出处和 B 站视频链接，并说明排名仅限十家固定样本。每家店展示一张图：使用返回的 cards_markdown 或 image.url 输出 Markdown 图片，不要只输出图片链接；图片明确标注“原探店视频封面”。needs_location 或 location_not_found 时不推荐门店或图片。';
const pointSchema = z.object({
  name:z.string(), lng:z.number(), lat:z.number(), source:z.url(),
  coordinate_source:z.literal('sample_fixture')
});
const shopSchema = z.object({
  name:z.string(), address:z.string(), lng:z.number(), lat:z.number(),
  source:z.url(), video:z.url(), meters:z.number().nonnegative(),
  image:z.object({url:z.url(), original_url:z.url(), source:z.url(), alt:z.string(),
    kind:z.literal('video_cover'), mime_type:z.literal('image/jpeg'), sha256:z.string()})
});
const outputSchema = z.object({
  status:z.enum(['ok', 'needs_location', 'location_not_found']),
  message:z.string(),
  origin:pointSchema.optional(),
  coordinate_system:z.literal('GCJ-02'),
  distance_type:z.literal('straight_line'),
  sample_count:z.literal(10),
  scope:z.string(),
  results:z.array(shopSchema).max(3),
  cards_markdown:z.string().optional()
});

function findNearby(location, audit) {
  const base = {coordinate_system:'GCJ-02', distance_type:'straight_line',
    sample_count:10, scope:'排名仅限 samples.js 中的10家北京固定样本，距离为直线距离。', results:[]};
  const text = location.trim().replace(/[\s，,。！？?!、]/g, '');
  if (!text || /^(?:我)?(?:的)?(?:附近|这里|这儿|周围|周边|在这里|在这儿|所在位置|当前位置|现在的位置)(?:有(?:什么|啥)|有什么好吃的|有什么餐厅|有什么探店餐厅)?$/.test(text)) {
    return {...base, status:'needs_location', message:'请提供你所在的酒店、地铁站或地标名称，再查询附近探店餐厅。'};
  }
  // P0 deliberately uses fixtures only: no network geocoding or implicit fallback.
  audit({event:'location_resolve', location, source:'sample_fixture'});
  const origin = resolveFixture(location);
  if (!origin) {
    return {...base, status:'location_not_found', message:'无法确认起点。本轮仅支持北京王府井、东坝、大钟寺的固定地铁站样本，请明确选择地点。'};
  }
  return {...base, status:'ok', message:'起点为固定样本坐标，非实时定位；以下为十家样本中的最近三家，按直线距离升序排列。',
    origin:{...origin, coordinate_source:'sample_fixture'}, results:closest(origin, restaurants)};
}

function createMcpServer(audit, baseUrl) {
  const server = new McpServer({name:'beijing-food-map', version:'1.0.0'}, {instructions});
  server.registerTool('find_nearby_food', {
    title:'北京附近探店',
    description:'按用户明确提供的北京地点，从十家固定探店样本中返回最近三家。支持王府井、东坝、大钟寺及望府井别名。没有明确位置必须先追问位置，用户补充后再调用，禁止猜测或默认起点。返回起点、直线距离、分店地址、探店和视频出处，以及每家一张原探店视频封面。用 cards_markdown 展示图文，包含 Markdown 图片。',
    inputSchema:z.object({location:z.string().max(80).describe('用户明确提供的地点名；无地点先追问，不能默认或猜测。')}),
    outputSchema,
    annotations:{readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  }, async ({location}) => {
    const data = findNearby(location, audit);
    if (data.status === 'ok') {
      data.results = data.results.map(shop => withImage(shop, baseUrl));
      data.cards_markdown = data.results.map(caption).join('\n');
    }
    audit({event:'tool_result', tool:'find_nearby_food', location, result:data});
    return {content:[{type:'text', text:JSON.stringify(data)}, ...imageContent(data.results)], structuredContent:data};
  });
  return server;
}

function json(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}

function createFoodServer({audit = () => {}, publicBaseUrl} = {}) {
  if (publicBaseUrl && !/^https?:$/.test(new URL(publicBaseUrl).protocol)) {
    throw new Error('PUBLIC_BASE_URL 必须使用 http 或 https');
  }
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
  return http.createServer(async (req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url.startsWith('/images/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return json(res, 405, {error:'图片仅支持读取'});
      }
      const image = imageForPath(req.url);
      if (!image) return json(res, 404, {error:'未找到图片'});
      res.writeHead(200, {'Content-Type':'image/jpeg', 'Content-Length':image.bytes.length,
        'Cache-Control':'no-cache', 'X-Content-Type-Options':'nosniff'});
      return res.end(req.method === 'HEAD' ? undefined : image.bytes);
    }
    if (req.url !== '/mcp') return json(res, 404, {error:'未找到请求地址'});
    // Stateless MCP has no standalone SSE or session deletion endpoint.
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return json(res, 405, {error:'请使用 Streamable HTTP POST /mcp'});
    }
    const baseUrl = publicBaseUrl || `http://${req.headers.host}`;
    const server = createMcpServer(audit, baseUrl);
    const transport = new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined, enableJsonResponse:true});
    try {
      await server.connect(transport);
      const dispatch = transport.onmessage;
      transport.onmessage = (message, extra) => {
        if (message.method) audit({event:'rpc', method:message.method,
          ...(message.method === 'tools/call' ? {tool:message.params?.name, arguments:message.params?.arguments} : {})});
        return dispatch(message, extra);
      };
      res.once('close', () => { void server.close(); });
      await transport.handleRequest(req, res);
    } catch {
      await server.close();
      if (!res.headersSent) json(res, 500, {error:'MCP 请求处理失败'});
      else res.end();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 8767);
  const server = createFoodServer({publicBaseUrl:process.env.PUBLIC_BASE_URL});
  server.listen(port, '127.0.0.1', () => console.log(`北京探店 MCP http://127.0.0.1:${server.address().port}/mcp`));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}

module.exports = {createFoodServer};
