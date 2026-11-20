const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {validateEvidence}=require('../scripts/check-live-evidence.cjs');
test('actual references require immutable files, matching hash, fixture=false and version',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-evidence-'));
 try{
  const file=path.join(dir,'proof.json'),version='v1-'+'a'.repeat(64);fs.writeFileSync(file,JSON.stringify({fixture:false,data_version:version}));
  const hash=()=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const record={status:'passed',fixture:false,source_commit:'b'.repeat(40),data_version:version,evidence_files:[{path:'proof.json',sha256:hash(),json_pointer:'/data_version',expected:version}]};
  validateEvidence(record,dir);
  for(const mutate of [r=>r.fixture=true,r=>r.data_version='v1-'+'c'.repeat(64),r=>r.evidence_files[0].sha256='0'.repeat(64),r=>r.evidence_files[0].path='missing.json']){const copy=structuredClone(record);mutate(copy);assert.throws(()=>validateEvidence(copy,dir));}
  fs.appendFileSync(file,' ');assert.throws(()=>validateEvidence(record,dir),/hash_mismatch/);
  fs.writeFileSync(file,JSON.stringify({fixture:false,data_version:'v1-'+'c'.repeat(64)}));record.evidence_files[0].sha256=hash();assert.throws(()=>validateEvidence(record,dir),/version_mismatch/);
  fs.writeFileSync(file,JSON.stringify({fixture:true,data_version:version}));record.evidence_files[0].sha256=hash();assert.throws(()=>validateEvidence(record,dir));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
