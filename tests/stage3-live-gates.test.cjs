// Explicit delivery gates. Missing evidence FAILS; offline fixtures cannot satisfy these.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const file=process.env.FOODMAP_STAGE3_LIVE_EVIDENCE||'evidence/FACT-33/live-acceptance.json';
const {validateEvidence}=require('../scripts/check-live-evidence.cjs');
test('every acceptance reference, including pending cases, remains verifiable',()=>{const all=JSON.parse(fs.readFileSync(file,'utf8'));for(const id of ['R2','R3','R4','E1','E2','E3'])validateEvidence(all[id]);});
for(const id of ['R2','R3','R4','E1','E2','E3'])test(id+' real acceptance evidence',()=>{const r=JSON.parse(fs.readFileSync(file,'utf8'))[id];assert.equal(r?.status,'passed');assert.equal(r?.fixture,false);assert.ok(r?.source_commit?.match(/^[a-f0-9]{40}$/));assert.ok(r?.evidence?.length);if(['R3','R4','E1','E2'].includes(id))assert.equal(r?.origin,'https://foodmap.shareworld.fun');if(id==='E1'){assert.ok(r.net_new_stores>=1);assert.ok(r.frame_sha256?.match(/^[a-f0-9]{64}$/));assert.equal(r.pi_settled_aborted,false);}if(id==='E3'){assert.equal(r.scheduler_owner,'python');assert.equal(r.legacy_status,'paused');}});
