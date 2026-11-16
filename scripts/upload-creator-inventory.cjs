'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');

const fields = {
  discoveries: ['bvid','creator_uid','title','published_at','discovered_at','owner_verified','source','checked_at'],
  accounts: ['uid','http_status','code','checked_at','url','scope','last_page','reached_end','obtained','first_bvid','last_bvid','restriction','next_step','error','last_success_at','last_success_range'],
  seasons: ['id','uid','title','total','obtained','reached_end','last_bvid','source','checked_at'],
  videos: ['bvid','checked_at','url','http_status','code','owner_uid','owner_verified','title','published_at','duration_seconds','season_id','error']
};
function select(row, keys) {
  return Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
}
function buildPayload(snapshot, report) {
  if (snapshot.schema !== 1 || !report.run_id || !report.checked_at || report.dry_run || report.outcome === 'locked') {
    throw new Error('缺少可上传的实际采集报告');
  }
  const clean = {schema: 1, updated_at: snapshot.updated_at};
  for (const [key, keys] of Object.entries(fields)) {
    let rows = snapshot[key] || [];
    if (key === 'discoveries' || key === 'videos') rows = rows.filter(row => row.owner_verified === true);
    clean[key] = rows.map(row => select(row, keys));
  }
  return {snapshot: clean, run: {
    ...select(report, ['run_id','checked_at','outcome','sources_checked','sources_ok','sources_restricted','sources_failed']),
    new_count: report.new_candidates.length
  }};
}
function pythonTransport(python) {
  return request => new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(__dirname, 'site-http.py')], {stdio: ['pipe', 'pipe', 'pipe']});
    let output = '', tooLarge = false;
    const timer = setTimeout(() => child.kill('SIGTERM'), 30000);
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 3 * 1024 * 1024) { tooLarge = true; child.kill('SIGTERM'); }
    });
    // Error output can contain third-party response text. Report a bounded transport error.
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('候选上传的 HTTP 运行环境不可用')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || tooLarge) return reject(new Error('候选上传的 HTTPS 请求失败'));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('候选上传响应格式无效')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(request));
  });
}
async function uploadInventory(payload, options = {}) {
  const site = new URL(options.url || process.env.FOODMAP_SITE_URL || '');
  if (site.protocol !== 'https:' || site.username || site.password) throw new Error('候选上传必须使用 HTTPS 站点');
  const token = options.token || process.env.FOODMAP_INGEST_TOKEN;
  if (!token) throw new Error('FOODMAP_INGEST_TOKEN 未配置');
  const url = new URL('/api/admin/content-ingest', site).href;
  const python = options.python || process.env.FOODMAP_HTTP_PYTHON;
  const transport = options.transport || (python ? pythonTransport(python) : async request => {
    const response = await fetch(request.url, {method: request.method,
      headers: {'Authorization': 'Bearer ' + request.token, 'Content-Type': 'application/json'},
      body: request.body, redirect: 'error', signal: AbortSignal.timeout(25000)});
    return {status: response.status, body: await response.text()};
  });
  async function send(method, body) {
    const response = await transport({url, method, token, body});
    if (response.status !== 200) throw new Error('候选上传接口返回 HTTP ' + response.status);
    let receipt;
    try { receipt = JSON.parse(response.body); } catch { throw new Error('候选上传接口未返回有效回执'); }
    if (!Number.isInteger(receipt.revision) || !Number.isInteger(receipt.discovered_count) || !receipt.last_run) {
      throw new Error('候选上传回执缺少版本和采集记录');
    }
    return receipt;
  }
  const saved = await send('POST', JSON.stringify(payload));
  const observed = await send('GET');
  if (observed.revision < saved.revision || observed.discovered_count < saved.discovered_count ||
      Date.parse(observed.last_run.checked_at) < Date.parse(payload.run.checked_at)) {
    throw new Error('候选上传后的持久读取未通过');
  }
  return {uploaded: true, ...observed};
}
if (require.main === module) {
  const [snapshotFile, reportFile] = process.argv.slice(2);
  if (!snapshotFile || !reportFile) {
    console.error('用法 node scripts/upload-creator-inventory.cjs <snapshot.json> <report.json>');
    process.exitCode = 1;
  } else {
    const payload = buildPayload(JSON.parse(fs.readFileSync(snapshotFile)), JSON.parse(fs.readFileSync(reportFile)));
    uploadInventory(payload).then(receipt => console.log(JSON.stringify(receipt)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
module.exports = {buildPayload, uploadInventory};
