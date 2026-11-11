const {McpServer} = require('@modelcontextprotocol/server');
const {NodeStreamableHTTPServerTransport, localhostHostValidation, localhostOriginValidation} = require('@modelcontextprotocol/node');
const {z} = require('zod');
const {withImage, caption, imageContent} = require('./images.cjs');

const instructions = '你是双城探店助手。用户没有明确提供位置（例如只问“我附近有什么？”）时，先追问所在城市、酒店、地铁站或地标，等用户补充后才调用 find_nearby_food。禁止猜位置、默认起点、IP、设备定位或跨会话记忆。用户补充位置后再查询。有歧义时展示城市、行政区、候选名称，让用户选择，再用 origin_id 查询。成功时告诉用户准确起点、坐标来源、最近三家完整分店名、直线距离、分店地址、探店出处和原视频链接。说明数据版本、固定样本范围和候选核对状态；固定验收样本不代表实时营业。每家有 image 时使用 cards_markdown 展示图片，按 image.kind 区分原视频截图与封面；作者、描述和播放入口取同一 card。无图时直接给文字，不可编造图片。needs_location、ambiguous、location_not_found 时不推荐门店或图片。';
const outputSchema = z.object({
  status:z.enum(['ok','needs_location','ambiguous','location_not_found']),
  message:z.string(), coordinate_system:z.literal('GCJ-02'), distance_type:z.literal('straight_line'),
  dataset:z.enum(['fixture','verified']), mode:z.enum(['fixture','live']), data_version:z.string(),
  sample_count:z.number(), scope:z.string(), results:z.array(z.object({
    name:z.string(), address:z.string(), city:z.string(), lng:z.number(),lat:z.number(),
    source:z.url(),video:z.url(),meters:z.number().nonnegative()
  }).passthrough()).max(3),
  origin:z.object({name:z.string(),city:z.string(),district:z.string(),lng:z.number(),lat:z.number(),
    source:z.url(),coordinate_source:z.enum(['sample_fixture','amap_live'])}).passthrough().optional(),
  candidates:z.array(z.object({id:z.string(),name:z.string(),city:z.string(),district:z.string()}).passthrough()).optional(),
  cards_markdown:z.string().optional()
});
function createMcpServer(audit, baseUrl, service, assets) {
  const server = new McpServer({name:'dual-city-food-map', version:'2.0.0'}, {instructions});
  server.registerTool('find_nearby_food', {
    title:'双城附近探店',
    description:'按用户明确提供的北京或上海地点查询附近探店。无位置先追问，不能猜测。歧义先展示城市与行政区候选，再传 origin_id。结果与网页共用门店、地点解析和直线距离排序，包含准确分店、地址和原视频；明确候选与固定样本限制。',
    inputSchema:z.object({location:z.string().max(80).describe('用户明确提供的地点名；缺少位置先追问'),
      city:z.enum(['北京','上海']).optional(), origin_id:z.string().max(120).optional()}),
    outputSchema,
    annotations:{readOnlyHint:true, destructiveHint:false, idempotentHint:true, openWorldHint:true}
  }, async input => {
    const data = decorate(await service.query(input), baseUrl, assets);
    audit({event:'tool_result', tool:'find_nearby_food', ...input, result:data});
    return {content:[{type:'text', text:JSON.stringify(data)}, ...imageContent(data.results,assets)], structuredContent:data};
  });
  return server;
}
function decorate(data,baseUrl,assets) {
  if(data.status!=='ok')return data;
  const results=data.results.map(shop=>withImage(shop,baseUrl,assets));
  return {...data,results,cards_markdown:results.map(caption).join('\n')};
}
function json(res, status, body) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
}

function createMcpHandler({audit=()=>{},publicBaseUrl,service,contentState}) {
  if(publicBaseUrl&&!/^https?:$/.test(new URL(publicBaseUrl).protocol))throw Error('PUBLIC_BASE_URL 必须使用 http 或 https');
  const validateHost=localhostHostValidation(), validateOrigin=localhostOriginValidation();
  return async (req,res)=>{
    if(!validateHost(req,res)||!validateOrigin(req,res))return;
    if(req.method!=='POST'){res.setHeader('Allow','POST');return json(res,405,{error:'请使用 Streamable HTTP POST /mcp'});}
    const server=createMcpServer(audit,publicBaseUrl||`http://${req.headers.host}`,service,contentState?.images);
    const transport=new NodeStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    try {
      await server.connect(transport);
      const dispatch=transport.onmessage;
      transport.onmessage=(message,extra)=>{
        if(message.method)audit({event:'rpc',method:message.method,...(message.method==='tools/call'?{tool:message.params?.name,arguments:message.params?.arguments}:{})});
        return dispatch(message,extra);
      };
      res.once('close',()=>{void server.close();});
      await transport.handleRequest(req,res);
    }catch{await server.close();if(!res.headersSent)json(res,500,{error:'MCP 请求处理失败'});else res.end();}
  };
}
function createFoodServer(options={}){return require('./amap-server.cjs').createServer(options);}
if(require.main===module){
  const port=Number(process.env.PORT||8767);
  const server=createFoodServer({mode:process.env.LOCATION_MODE||'fixture',dataset:process.env.DATASET||'fixture',
    serviceKey:process.env.AMAP_WEB_SERVICE_KEY,jsKey:process.env.AMAP_JS_KEY,securityCode:process.env.AMAP_JS_SECURITY_CODE,
    publicBaseUrl:process.env.PUBLIC_BASE_URL});
  server.listen(port,'127.0.0.1',()=>console.log(`双城探店 http://127.0.0.1:${port}/ (MCP /mcp)`));
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close());
}
module.exports={createFoodServer,createMcpHandler,decorate};
