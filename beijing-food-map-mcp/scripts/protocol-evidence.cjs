const {once} = require('node:events');
const {writeFileSync, mkdirSync} = require('node:fs');
const {resolve} = require('node:path');
const {Client, StreamableHTTPClientTransport} = require('@modelcontextprotocol/client');
const {createFoodServer} = require('../mcp-server.cjs');

async function main() {
  const exchanges = [];
  const audit = [];
  const server = createFoodServer({audit:event => audit.push(event)});
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  const client = new Client({name:'protocol-evidence', version:'1.0.0'});
  try {
    await client.connect(new StreamableHTTPClientTransport(url, {fetch:async (input, init) => {
      const response = await fetch(input, init);
      const body = await response.clone().text();
      exchanges.push({method:init?.method || 'GET',
        request:init?.body ? JSON.parse(init.body) : undefined,
        status:response.status, response:body ? JSON.parse(body) : null});
      return response;
    }}));
    await client.listTools();
    for (const location of ['王府井', '东坝', '大钟寺', '望府井', '', '我附近', '未知地点']) {
      await client.callTool({name:'find_nearby_food', arguments:{location}});
    }
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    const evidence = resolve(__dirname, '../evidence/images');
    mkdirSync(evidence, {recursive:true});
    writeFileSync(resolve(evidence, '03-protocol-exchanges.json'), JSON.stringify({exchanges, audit}, null, 2) + '\n');
  }
  console.log('Saved actual SDK HTTP initialize / tools/list / tools/call exchanges.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
