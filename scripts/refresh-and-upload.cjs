'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {runIncremental} = require('./refresh-creator-inventory-incremental.cjs');
const {buildPayload, uploadInventory} = require('./upload-creator-inventory.cjs');

async function refreshAndUpload() {
  const report = await runIncremental();
  if (report.outcome === 'locked') {
    console.log(JSON.stringify({outcome: 'locked', uploaded: false}));
    return;
  }
  const snapshot = JSON.parse(fs.readFileSync(report.snapshot_file, 'utf8'));
  const receipt = await uploadInventory(buildPayload(snapshot, report));
  const file = path.join(report.runs_dir, report.checked_at.replace(/[:.]/g, '-'), 'upload-receipt.json');
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({run_id: report.run_id, outcome: report.outcome,
    sources_checked: report.sources_checked, sources_ok: report.sources_ok,
    sources_restricted: report.sources_restricted, sources_failed: report.sources_failed,
    new_candidates: report.new_candidates.length, uploaded: true,
    revision: receipt.revision, discovered_count: receipt.discovered_count,
    report_file: file.replace('upload-receipt.json', 'report.json'), receipt_file: file}));
}
if (require.main === module) refreshAndUpload().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
module.exports = {refreshAndUpload};
