const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {Client, StreamableHTTPClientTransport} = require('@modelcontextprotocol/client');
const {origins, restaurants} = require('./samples.js');

// Intentional ATDD seam: the server did not exist when these tests were first run.
async function connect(t) {
  const {createFoodServer} = require('./mcp-server.cjs');
  const events = [];
  const server = createFoodServer({audit: event => events.push(event)});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({name:'food-map-acceptance', version:'1.0.0'});
  t.after(async () => {
    await client.close();
    await new Promise(resolve => server.close(resolve));
  });
  await client.connect(new StreamableHTTPClientTransport(url));
  return {client, url, events};
}

async function call(client, location) {
  const result = await client.callTool({name:'find_nearby_food', arguments:{location}});
  assert.notEqual(result.isError, true);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  return result.structuredContent;
}

test('真实 Streamable HTTP 初始化、发现一个只读工具及输出 schema', async t => {
  const {client, events} = await connect(t);
  assert.equal(client.getServerVersion().name, 'beijing-food-map');
  assert.match(client.getInstructions(), /位置/);
  const {tools} = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['find_nearby_food']);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[0].annotations.destructiveHint, false);
  assert.equal(tools[0].annotations.openWorldHint, false);
  assert.ok(tools[0].outputSchema);
  assert.equal(tools[0].inputSchema.properties.location.type, 'string');
  assert.ok(events.some(e => e.method === 'initialize'));
  assert.ok(events.some(e => e.method === 'tools/list'));
});

const cases = {
  '王府井': {names:['富春居', '泰丰楼', '北京宜宾招待所'], km:[1.72, 1.92, 2.82]},
  '东坝': {names:['寂川', '潇湘阁', '老吉堂'], km:[8.11, 8.81, 8.93]},
  '大钟寺': {names:['洪福亮酒家', '砂锅居', '同和居'], km:[3.74, 5.68, 5.85]}
};
for (const [location, expected] of Object.entries(cases)) {
  test(`${location}返回正确样本起点、最近三家、米制直线距离及完整出处`, async t => {
    const {client} = await connect(t);
    const data = await call(client, location);
    assert.equal(data.status, 'ok');
    assert.equal(data.origin.name, origins[location].name);
    assert.equal(data.origin.lng, origins[location].lng);
    assert.equal(data.origin.lat, origins[location].lat);
    assert.equal(data.origin.source, origins[location].source);
    assert.equal(data.origin.coordinate_source, 'sample_fixture');
    assert.equal(data.coordinate_system, 'GCJ-02');
    assert.equal(data.distance_type, 'straight_line');
    assert.equal(data.sample_count, 10);
    assert.match(data.scope, /10.*样本/);
    assert.equal(data.results.length, 3);
    data.results.forEach((shop, index) => {
      assert.ok(shop.name.startsWith(expected.names[index]));
      assert.ok(Math.abs(shop.meters / 1000 - expected.km[index]) < 0.05);
      assert.ok(index === 0 || shop.meters >= data.results[index - 1].meters);
      const original = restaurants.find(item => item.name === shop.name);
      for (const field of ['name', 'address', 'lng', 'lat', 'source', 'video']) {
        assert.equal(shop[field], original[field]);
      }
    });
  });
}

test('望府井别名及北京前缀、地铁站后缀复用正确起点', async t => {
  const {client} = await connect(t);
  for (const alias of ['望府井', ' 北京市望府井地铁站 ']) {
    assert.equal((await call(client, alias)).origin.name, '王府井地铁站');
  }
});

for (const location of ['', '  ', '我附近', '我附近有什么？', '附近', '我在这里', '当前位置']) {
  test(`缺位置 ${JSON.stringify(location)}：needs_location，无结果、无地点解析`, async t => {
    const {client, events} = await connect(t);
    const data = await call(client, location);
    assert.equal(data.status, 'needs_location');
    assert.equal(data.origin, undefined);
    assert.deepEqual(data.results, []);
    assert.match(data.message, /位置|地点|地标|地铁站/);
    assert.equal(events.filter(e => e.event === 'location_resolve').length, 0);
  });
}

test('未知地点不复用同客户端上次起点，缺位置后补东坝才解析', async t => {
  const {client, events} = await connect(t);
  await call(client, '王府井');
  const unknown = await call(client, '一个不存在的地点xyz');
  assert.equal(unknown.status, 'location_not_found');
  assert.deepEqual(unknown.results, []);
  assert.equal(unknown.origin, undefined);
  const count = events.filter(e => e.event === 'location_resolve').length;
  assert.equal((await call(client, '我附近')).status, 'needs_location');
  assert.equal(events.filter(e => e.event === 'location_resolve').length, count);
  assert.equal((await call(client, '东坝')).origin.name, '东坝地铁站');
});

test('非字符串参数拒绝；并发不同地点互不串用', async t => {
  const {client} = await connect(t);
  const invalid = await client.callTool({name:'find_nearby_food', arguments:{location:42}});
  assert.equal(invalid.isError, true);
  const data = await Promise.all(Object.keys(cases).map(location => call(client, location)));
  assert.deepEqual(data.map(item => item.origin.name), Object.values(origins).map(o => o.name));
});

test('HTTP 路径、非法 JSON、方法及跨源请求边界', async t => {
  const {url} = await connect(t);
  assert.equal((await fetch(new URL('/missing', url))).status, 404);
  assert.equal((await fetch(url, {method:'PUT'})).status, 405);
  assert.equal((await fetch(url, {method:'POST', headers:{'content-type':'application/json',
    accept:'application/json, text/event-stream'}, body:'{'})).status, 400);
  assert.equal((await fetch(url, {method:'POST', headers:{origin:'https://untrusted.example',
    'content-type':'application/json', accept:'application/json, text/event-stream'}, body:'{}'})).status, 403);
});
