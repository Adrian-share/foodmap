'use strict';
const fs=require('node:fs');
const {sshTransport}=require('./upload-creator-inventory.cjs');
async function sendOperation(op,config,transport){
 const url='https://foodmap.shareworld.fun/api/admin/content-ingest';
 if(!config.FOODMAP_INGEST_TOKEN||config.FOODMAP_SITE_URL!=='https://foodmap.shareworld.fun'||config.FOODMAP_UPLOAD_SSH_HOST!=='foodmap-uploader')throw Error('invalid_upload_configuration');
 const body=op===null?null:JSON.stringify(op);
 if(body&&Buffer.byteLength(body)>2*1024*1024)throw Error('operation_too_large');
 const send=transport||sshTransport('foodmap-uploader');
 const response=await send({url,method:op===null?'GET':'POST',token:config.FOODMAP_INGEST_TOKEN,body});
 if(response.status!==200)throw Error('operation_http_'+response.status);
 const value=JSON.parse(response.body);
 if(op!==null&&(!value.status||!value.request_id))throw Error('invalid_operation_receipt');
 return value;
}
if(require.main===module){
 const configFile=process.argv[2];let raw='';
 process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{raw+=c;if(Buffer.byteLength(raw)>2*1024*1024)process.exit(1);});
 process.stdin.on('end',async()=>{try{const config={};for(const line of fs.readFileSync(configFile,'utf8').split(/\r?\n/)){const match=line.match(/^(FOODMAP_(?:SITE_URL|INGEST_TOKEN|UPLOAD_SSH_HOST))=(.*)$/);if(match)config[match[1]]=match[2];}console.log(JSON.stringify(await sendOperation(JSON.parse(raw),config)));}catch{console.error('operation_failed');process.exitCode=1;}});
}
module.exports={sendOperation};
