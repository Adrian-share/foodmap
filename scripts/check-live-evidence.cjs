'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function validateEvidence(r,root=process.cwd()){
 if(r.fixture!==false||!/^[a-f0-9]{40}$/.test(r.source_commit||'')||!/^v1-[a-f0-9]{64}$/.test(r.data_version||''))throw Error('invalid_live_identity');
 if(!Array.isArray(r.evidence_files)||!r.evidence_files.length)throw Error('missing_live_references');
 for(const ref of r.evidence_files){
  const file=path.resolve(root,ref.path);if(!file.startsWith(path.resolve(root)+path.sep))throw Error('outside_evidence_root');
  const raw=fs.readFileSync(file);if(crypto.createHash('sha256').update(raw).digest('hex')!==ref.sha256)throw Error('live_evidence_hash_mismatch');
  if(file.endsWith('.json')){const value=JSON.parse(raw);if(value.fixture===true)throw Error('fixture_is_not_live_evidence');
   if(ref.json_pointer){let v=value;for(const k of ref.json_pointer.slice(1).split('/'))v=v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')];if(v!==ref.expected||ref.expected!==r.data_version)throw Error('live_evidence_version_mismatch');}
  }
 }
 if(!r.evidence_files.some(x=>x.json_pointer))throw Error('missing_version_reference');
}
module.exports={validateEvidence};
