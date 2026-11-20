'use strict';
// Fixed local deterministic check only. No HTTP, model, queue or publication.
const {validateStoreIdentity,identityPending}=require('../content/store-identity.cjs');
let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{raw+=c;if(Buffer.byteLength(raw)>16*1024*1024)process.exit(1);});
process.stdin.on('end',async()=>{try{const value=JSON.parse(raw);const identity=await validateStoreIdentity(value);console.log(JSON.stringify({pending:value.records.flatMap(r=>identityPending(r,identity.aliases).map(reason=>({bvid:r.video.bvid,part:r.video.part,visit_id:r.visit.id,reason})))}));}catch(error){console.log(JSON.stringify({error_code:error.message}));process.exitCode=1;}});
