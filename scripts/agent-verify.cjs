'use strict';
const {verifyExtraction}=require('../content/verification.cjs');
let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{raw+=c;if(Buffer.byteLength(raw)>16*1024*1024)process.exit(1);});
process.stdin.on('end',async()=>{try{const r=await verifyExtraction(JSON.parse(raw));console.log(JSON.stringify({...r,documents:r.documents.map(d=>({...d,bytes_base64:Buffer.from(d.bytes).toString('base64'),bytes:undefined}))}));}catch{console.error('verification_failed');process.exitCode=1;}});
