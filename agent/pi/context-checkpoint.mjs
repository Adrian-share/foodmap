import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
// No prompt, proposal, credentials or session control enters the recovery file.
export async function checkpointContext(context){
 const base=await fs.realpath(context.root);
 if((await fs.lstat(context.root)).isSymbolicLink()||base!==path.resolve(context.root))throw Error('outside_evidence_root');
 const identity=Object.fromEntries(['task_id','creator_uid','bvid','part','root'].map(k=>[k,context[k]]));
 if(Object.values(identity).some(x=>x===undefined))throw Error('missing_checkpoint_identity');
 const value={schema_version:1,...identity,evidence:Object.fromEntries(Object.entries(context.evidence||{}).filter(([id])=>id!=='discovery')),
  frame_files:context.frame_files||{},model_preview_bytes:context.model_preview_bytes||0};
 const raw=Buffer.from(JSON.stringify(value));if(raw.length>2*1024*1024)throw Error('checkpoint_too_large');
 const file=path.join(base,'registered-context.json');
 try{if((await fs.lstat(file)).isSymbolicLink())throw Error('symlink_checkpoint');}catch(error){if(error.code!=='ENOENT')throw error;}
 const temp=path.join(base,'.registered-'+crypto.randomUUID()+'.tmp'),handle=await fs.open(temp,'wx',0o600);
 try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 await fs.rename(temp,file);
}
