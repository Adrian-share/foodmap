// Precompile frozen JSON schemas: Workers disallow runtime eval / new Function.
const fs=require('node:fs'),crypto=require('node:crypto');
const Ajv=require('ajv/dist/2020.js'),formats=require('ajv-formats'),standalone=require('ajv/dist/standalone');
const file='docs/architecture/FACT-31/schemas.json',raw=fs.readFileSync(file),schema=JSON.parse(raw);
const ajv=new Ajv({strict:false,code:{source:true}});formats(ajv);
const refs={};for(const name of ['operation','operation_receipt','manifest','verification','extraction','record','pointer','transition']){const key='foodmap:'+name;ajv.addSchema({$id:key,$defs:schema.$defs,$ref:'#/$defs/'+name});refs[name]=key;}
const source='// Generated from frozen schemas SHA256 '+crypto.createHash('sha256').update(raw).digest('hex')+'; run node scripts/build-protocol-validators.cjs\n'+standalone(ajv,refs)+'\n';
fs.writeFileSync('content/protocol-validators.cjs',source);
