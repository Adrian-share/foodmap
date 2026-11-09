const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const {mkdirSync, writeFileSync, mkdtempSync} = require('node:fs');
const {join, resolve} = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {createFoodServer} = require('../mcp-server.cjs');
const {origins, restaurants, closest} = require('../samples.js');

const root = resolve(__dirname, '..');
const evidence = join(root, 'evidence', 'codex-images');
mkdirSync(evidence, {recursive:true});
const working = mkdtempSync(join(evidence, 'empty-session-'));
const audit = [];
const server = createFoodServer({audit:event => audit.push({at:new Date().toISOString(), ...event})});
const scrub = text => text.replaceAll(root, '<PROJECT>').replaceAll(os.homedir(), '<HOME>');
const policy = '请用简体中文作为北京探店助手答复用户，使用配置的 beijing_food_map MCP 工具完成附近探店查询，并遵守该服务的 instructions。不要读取文件、使用 shell、其他工具或网络搜索。用户输入仅为地点和找店需求。';

function codexArgs(url) {
  return ['--skip-git-repo-check', '--ignore-user-config', '--json',
    '-c', 'project_doc_max_bytes=0',
    '-c', 'features.shell_tool=false', '-c', 'features.apps=false',
    '-c', 'features.plugins=false', '-c', 'web_search="disabled"',
    '-c', 'model_reasoning_effort="medium"',
    '-c', `developer_instructions=${JSON.stringify(policy)}`,
    '-c', `mcp_servers.beijing_food_map.url=${JSON.stringify(url)}`,
    '-c', 'mcp_servers.beijing_food_map.required=true',
    '-c', 'mcp_servers.beijing_food_map.startup_timeout_sec=20',
    '-c', 'mcp_servers.beijing_food_map.tool_timeout_sec=30'];
}

async function turn(id, question, url, threadId) {
  const from = audit.length;
  const args = ['exec', ...(threadId ? ['resume'] : []), ...codexArgs(url),
    ...(threadId ? [threadId, question] : ['--sandbox', 'read-only', '-C', working, question])];
  const started = new Date().toISOString();
  const child = spawn(process.env.CODEX_BIN || 'codex', args, {cwd:working, stdio:['ignore','pipe','pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const deadline = setTimeout(() => child.kill('SIGTERM'), 240000);
  let code;
  try { [code] = await once(child, 'close'); } finally { clearTimeout(deadline); }
  const events = stdout.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return {unparsed:line}; } });
  const record = {id, question, started, completed:new Date().toISOString(), exit_code:code,
    command:['codex', ...args.map(value => scrub(value))], events, audit:audit.slice(from)};
  writeFileSync(join(evidence, `${id}.json`), scrub(JSON.stringify(record, null, 2)) + '\n');
  writeFileSync(join(evidence, `${id}.jsonl`), scrub(stdout));
  writeFileSync(join(evidence, `${id}.stderr.log`), scrub(stderr));
  assert.equal(code, 0, `${id} Codex failed: ${scrub(stderr.slice(-1500))}`);
  const thread = events.find(event => event.type === 'thread.started')?.thread_id || threadId;
  assert.ok(thread, `${id}: session ID missing`);
  const replies = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message').map(event => event.item.text);
  assert.ok(replies.length, `${id}: no assistant reply`);
  const result = {...record, thread, reply:replies.join('\n\n')};
  console.log(`${id}: Codex finished; ${record.audit.filter(e => e.event === 'tool_result').length} MCP result(s)`);
  return result;
}

function verifySuccess(record, location) {
  const calls = record.audit.filter(event => event.event === 'rpc' && event.method === 'tools/call');
  assert.ok(calls.some(event => event.tool === 'find_nearby_food' && event.arguments.location.includes(location)), 'Missing real MCP call');
  const result = record.audit.find(event => event.event === 'tool_result' && event.result.status === 'ok')?.result;
  assert.ok(result, 'Missing successful tool result');
  assert.equal(result.origin.name, origins[location].name);
  assert.equal(result.origin.coordinate_source, 'sample_fixture');
  const expected = closest(origins[location], restaurants);
  assert.deepEqual(result.results.map(({image, ...shop}) => shop), expected);
  const completedCall = record.events.find(event => event.type === 'item.completed'
    && event.item?.type === 'mcp_tool_call' && event.item.status === 'completed');
  assert.ok(completedCall, 'Missing Codex MCP completed event');
  const returnedImages = completedCall.item.result.content.filter(block => block.type === 'image');
  assert.equal(returnedImages.length, 3, 'Codex must receive three actual image blocks');
  assert.ok(record.reply.includes(origins[location].name), 'Reply must name parsed origin');
  assert.match(record.reply, /直线/);
  assert.match(record.reply, /样本/);
  let previousIndex = -1;
  for (const [imageIndex, shop] of result.results.entries()) {
    const name = shop.name.replace(/[（(].*$/, '');
    const index = record.reply.indexOf(name);
    assert.ok(index > previousIndex, `Reply order/name: ${name}`);
    previousIndex = index;
    const km = (shop.meters / 1000).toFixed(2);
    assert.ok(record.reply.includes(km) || record.reply.includes(String(Math.round(shop.meters))), `Reply distance missing: ${km}km`);
    assert.ok(record.reply.includes(shop.source), `Reply source missing: ${name}`);
    assert.ok(record.reply.includes(shop.video.replace(/\/$/, '')), `Reply video missing: ${name}`);
    assert.ok(record.reply.includes(shop.image.url), `Reply image URL missing: ${name}`);
    assert.ok(record.reply.includes(`](${shop.image.url})`), `Reply must embed a Markdown image: ${name}`);
    assert.equal(createHash('sha256').update(Buffer.from(returnedImages[imageIndex].data, 'base64')).digest('hex'), shop.image.sha256);
  }
  assert.equal((record.reply.match(/!\[/g) || []).length, 3, 'Exactly one Markdown image per result');
  assert.match(record.reply, /视频封面/);
}

async function main() {
  const summary = {started:new Date().toISOString(), client:execFileSync(process.env.CODEX_BIN || 'codex', ['--version'], {encoding:'utf8'}).trim(), cases:[]};
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  summary.url = url;
  const conversations = [];
  try {
    // Fresh missing-location conversation is run before any concrete location.
    const first = await turn('MCP-04-turn1', '我附近有什么？', url);
    assert.equal(first.audit.filter(event => event.event === 'location_resolve').length, 0);
    assert.ok(first.audit.filter(event => event.event === 'tool_result').every(event => event.result.status === 'needs_location'));
    assert.match(first.reply, /位置|地点|酒店|地铁站|地标/);
    for (const shop of restaurants) assert.ok(!first.reply.includes(shop.name));
    for (const origin of Object.values(origins)) assert.ok(!first.reply.includes(origin.name));
    const second = await turn('MCP-04-turn2', '东坝', url, first.thread);
    verifySuccess(second, '东坝');
    assert.equal(second.thread, first.thread);
    conversations.push(first, second);
    summary.cases.push({id:'MCP-04', status:'passed', thread:first.thread, first_turn_location_resolutions:0,
      first_turn_tool_calls:first.audit.filter(e => e.event === 'tool_result').length,
      second_turn_tool_calls:second.audit.filter(e => e.event === 'tool_result').length});
    const cases = [
      ['MCP-01', '我在王府井，附近有哪些探店餐厅？', '王府井'],
      ['MCP-02', '我现在住东坝，找三家最近的探店餐厅。', '东坝'],
      ['MCP-03', '大钟寺附近有哪些探店餐厅？', '大钟寺']
    ];
    for (const [id, question, location] of cases) {
      const record = await turn(id, question, url);
      verifySuccess(record, location);
      conversations.push(record);
      summary.cases.push({id, status:'passed', thread:record.thread,
        tool_calls:record.audit.filter(e => e.event === 'tool_result').length});
    }
    assert.equal(new Set(summary.cases.map(item => item.thread)).size, 4);
    summary.status = 'passed';
    summary.presentation_verification = 'Codex received actual JPEG image blocks and replied with three Markdown images; graphical client rendering not verified.';
  } catch (error) {
    summary.status = 'failed'; summary.error = error.message;
    throw error;
  } finally {
    summary.completed = new Date().toISOString();
    writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    writeFileSync(join(evidence, 'audit.jsonl'), audit.map(event => JSON.stringify(event)).join('\n') + '\n');
    const transcript = conversations.map(record => `## ${record.id}\n\n用户：${record.question}\n\nCodex：\n\n${record.reply}\n\n工具调用：\n\n\`\`\`json\n${JSON.stringify(record.audit.filter(e => ['tool_result','location_resolve'].includes(e.event)), null, 2)}\n\`\`\`\n`).join('\n');
    writeFileSync(join(evidence, 'conversations.md'), transcript);
    await new Promise(resolve => server.close(resolve));
  }
  console.log('Codex: all four P0 cases passed; no server is left running.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
