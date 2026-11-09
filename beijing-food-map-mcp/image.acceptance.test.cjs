const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {Client, StreamableHTTPClientTransport} = require('@modelcontextprotocol/client');
const {createFoodServer} = require('./mcp-server.cjs');
const {origins, restaurants} = require('./samples.js');

async function connect(t) {
  const server = createFoodServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({name:'food-images-acceptance', version:'1.0.0'});
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); });
  await client.connect(new StreamableHTTPClientTransport(url));
  return {client, url};
}

test('十家原始门店各有一张来自其原视频的真实封面，记录哈希及出处', () => {
  const manifest = require('./assets/images/manifest.json');
  assert.equal(manifest.length, 10);
  assert.equal(new Set(manifest.map(item => item.file)).size, 10);
  for (const shop of restaurants) {
    const image = manifest.find(item => item.restaurant === shop.name);
    assert.ok(image, shop.name);
    assert.equal(image.source, shop.video);
    assert.equal(image.kind, 'video_cover');
    assert.match(image.original_url, /^https:\/\/i[012]\.hdslb\.com\/bfs\/archive\//);
    assert.ok(image.title && image.fetched_at);
    const bytes = readFileSync(join(__dirname, 'assets/images', image.file));
    assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), image.sha256);
    assert.ok(bytes.length > 1000 && bytes.length < 200000);
  }
});

for (const location of Object.keys(origins)) {
  test(`${location}通过真实 MCP 返回三个对应图片块、图文及可读取的本地图片地址`, async t => {
    const {client} = await connect(t);
    const result = await client.callTool({name:'find_nearby_food', arguments:{location}});
    assert.equal(result.structuredContent.status, 'ok');
    const images = result.content.filter(block => block.type === 'image');
    assert.equal(images.length, 3);
    const data = result.structuredContent;
    assert.deepEqual(JSON.parse(result.content[0].text), data);
    assert.equal((data.cards_markdown.match(/!\[/g) || []).length, 3);
    for (let index = 0; index < 3; index++) {
      const shop = data.results[index];
      assert.equal(shop.image.kind, 'video_cover');
      assert.equal(shop.image.source, shop.video);
      assert.equal(images[index].mimeType, 'image/jpeg');
      const bytes = Buffer.from(images[index].data, 'base64');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), shop.image.sha256);
      const response = await fetch(shop.image.url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/jpeg');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.ok(data.cards_markdown.includes(shop.name));
      assert.ok(data.cards_markdown.includes((shop.meters / 1000).toFixed(2)));
      assert.ok(data.cards_markdown.includes(shop.image.url));
      assert.ok(data.cards_markdown.includes(shop.source));
      assert.ok(data.cards_markdown.includes(shop.video));
      assert.match(data.cards_markdown, /探店视频封面/);
    }
  });
}

test('缺位置及未知位置不返回图片或图文推荐', async t => {
  const {client} = await connect(t);
  for (const location of ['', '我附近有什么？', '未知地点']) {
    const result = await client.callTool({name:'find_nearby_food', arguments:{location}});
    assert.deepEqual(result.structuredContent.results, []);
    assert.equal(result.content.filter(block => block.type === 'image').length, 0);
    assert.equal(result.structuredContent.cards_markdown, undefined);
  }
});

test('图片路径只允许已登记资产，保持只读及跨源边界', async t => {
  const {url} = await connect(t);
  assert.equal((await fetch(new URL('/images/not-a-store.jpg', url))).status, 404);
  assert.equal((await fetch(new URL('/images/%2e%2e%2fsamples.js', url))).status, 404);
  assert.equal((await fetch(new URL('/images/BV1ma411v7V1.jpg', url), {method:'POST'})).status, 405);
});
