'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {runIncremental} = require('./refresh-creator-inventory-incremental.cjs');
const {buildPayload, uploadInventory} = require('./upload-creator-inventory.cjs');

async function refreshAndUpload({signal} = {}) {
  signal?.throwIfAborted();
  const config = process.env.FOODMAP_AGENT_ENV_FILE || path.join(os.homedir(), '.config/foodmap/ingest.env');
  if (fs.existsSync(config)) {
    for (const line of fs.readFileSync(config, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^(FOODMAP_(?:SITE_URL|INGEST_TOKEN|AGENT_STATE_DIR|INGEST_URL|UPLOAD_SSH_HOST))=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  }
  if (!process.env.FOODMAP_INGEST_TOKEN) throw new Error('FOODMAP_INGEST_TOKEN 未配置');
  const report = await runIncremental({signal});
  signal?.throwIfAborted();
  if (report.outcome === 'locked') {
    console.log(JSON.stringify({outcome: 'locked', uploaded: false}));
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(report.run_snapshot_file || report.snapshot_file, 'utf8'));
  const receipt = await uploadInventory(buildPayload(snapshot, report), {signal});
  signal?.throwIfAborted();
  const dir = report.run_dir || path.join(report.runs_dir, report.checked_at.replace(/[:.]/g, '-'));
  const file = path.join(dir, 'upload-receipt.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(receipt, null, 2) + '\n');
  fs.renameSync(file + '.tmp', file);
  console.log(JSON.stringify({run_id: report.run_id, outcome: report.outcome,
    sources_checked: report.sources_checked, sources_ok: report.sources_ok,
    sources_restricted: report.sources_restricted, sources_failed: report.sources_failed,
    sources_deferred: report.sources_deferred, sources_skipped_limit: report.sources_skipped_limit,
    new_candidates: report.new_candidates.length, uploaded: true,
    revision: receipt.revision, discovered_count: receipt.discovered_count,
    report_file: file.replace('upload-receipt.json', 'report.json'), receipt_file: file}));
}
if (require.main === module) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('用法: node scripts/refresh-and-upload.cjs\n从私有配置读取参数，执行增量采集和候选上传，stdout输出JSON回执。\n配置文件: FOODMAP_AGENT_ENV_FILE，默认 ~/.config/foodmap/ingest.env\n配置项: FOODMAP_SITE_URL、FOODMAP_INGEST_TOKEN、FOODMAP_AGENT_STATE_DIR、FOODMAP_INGEST_URL、FOODMAP_UPLOAD_SSH_HOST\n--help / -h: 显示帮助，不读取凭据、不触发采集。');
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    refreshAndUpload({signal: controller.signal}).catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    }).finally(() => {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    });
  }
}
module.exports = {refreshAndUpload};
