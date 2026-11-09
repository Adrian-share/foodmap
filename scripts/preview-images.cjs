const {once} = require('node:events');
const {mkdirSync, writeFileSync} = require('node:fs');
const {resolve} = require('node:path');
const {Client, StreamableHTTPClientTransport} = require('@modelcontextprotocol/client');
const {createFoodServer} = require('../mcp-server.cjs');

const escape = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));

async function main() {
  const server = createFoodServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new Client({name:'image-preview-export', version:'1.0.0'});
  const snapshots = [];
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.address().port}/mcp`)));
    for (const location of ['王府井', '东坝', '大钟寺']) {
      const response = await client.callTool({name:'find_nearby_food', arguments:{location}});
      const images = response.content.filter(block => block.type === 'image');
      snapshots.push({data:response.structuredContent, images});
    }
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
  }
  const sections = snapshots.map(({data, images}) => `<section><h2>${escape(data.origin.name)} <small>固定样本起点</small></h2><div class="cards">` +
    data.results.map((shop, index) => `<article><div class="photo"><img src="data:${images[index].mimeType};base64,${images[index].data}" alt="${escape(shop.image.alt)}"><span>原探店视频封面</span></div><div class="body"><div class="rank">${index + 1} · 样本中的最近门店</div><h3>${escape(shop.name)}</h3><p class="distance">${(shop.meters / 1000).toFixed(2)} <small>km · 直线距离</small></p><p class="address">${escape(shop.address)}</p><footer><a href="${escape(shop.source)}">探店出处 ↗</a><a href="${escape(shop.image.source)}">图片出处 / B 站视频 ↗</a></footer></div></article>`).join('') + '</div></section>').join('');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>北京探店 · MCP 图文返回样例</title><style>
  *{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#24372f;font:16px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:1200px;margin:32px auto;padding:0 20px}.eyebrow{font-size:13px;letter-spacing:2px;color:#71816a}h1{font-size:32px;margin:4px 0 6px}header p{margin:0;color:#687368}header{margin-bottom:24px}h2{font-size:21px;margin:20px 0 12px}h2 small{margin-left:12px;font-size:12px;font-weight:400;color:#778174}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}article{background:white;border:1px solid #e1e5d9;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px #24372f06}.photo{position:relative}.photo img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}.photo span{position:absolute;bottom:10px;left:10px;background:#fffdf1e8;border-radius:4px;padding:2px 8px;font-size:11px}.body{padding:14px 16px}.rank{font-size:11px;color:#7d846b}h3{font-size:18px;margin:4px 0;min-height:29px}.distance{font-size:28px;font-weight:650;margin:4px 0;color:#245a46}.distance small{font-size:12px;font-weight:400;color:#728074}.address{font-size:12px;color:#778077;min-height:39px;margin:4px 0 12px}footer{display:flex;justify-content:space-between;border-top:1px solid #edf0e7;padding-top:9px;font-size:12px}a{color:#2d6750;text-decoration:none}.note{font-size:12px;color:#778074;margin:22px 0}@media(max-width:700px){.cards{grid-template-columns:1fr}}
  </style><main><header><div class="eyebrow">北京 · 附近探店</div><h1>每家店一张真实图片</h1><p>名称 · 直线距离 · 探店出处。以下图文由真实 MCP 工具返回的数据和 JPEG 图片生成。</p></header>${sections}<p class="note">范围仅限十家固定样本；使用 GCJ-02 样本起点。图片为各店原探店视频封面，可能包含菜品、博主和封面文字。此文件是展示样例，非 Codex 图形界面截图。</p></main></html>`;
  const directory = resolve(__dirname, '../evidence/images');
  mkdirSync(directory, {recursive:true});
  writeFileSync(resolve(directory, 'images-preview.html'), html);
  writeFileSync(resolve(directory, 'preview-data.json'), JSON.stringify(snapshots.map(({data}) => data), null, 2) + '\n');
  console.log('Exported standalone image preview from three real MCP calls.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
