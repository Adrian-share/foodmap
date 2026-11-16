import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const runFile=promisify(execFile);
export function publicEnvironment(parent){
 const env={PATH:'/usr/bin:/bin'};
 for(const key of ['HOME','TMPDIR','LANG','LC_ALL','SYSTEMROOT'])if(parent[key])env[key]=parent[key];
 return env;
}
export async function readPublicPoi(query,signal,runner=runFile){
 if(typeof query!=='string'||!query.trim()||query.length>80||/[\u0000-\u001f\u007f]/.test(query))throw Error('invalid_poi_query');
 signal?.throwIfAborted();
 const pending=runner(path.join(root,'tools/venv/bin/python'),['-I',path.join(root,'scripts/agent-public-json.py')],{cwd:root,env:publicEnvironment(process.env),timeout:20000,maxBuffer:600*1024,signal});
 pending.child.stdin.end(JSON.stringify({operation:'poi',query}));
 let raw;
 try{raw=(await pending).stdout;}catch(error){
  if(signal?.aborted)throw error;
  throw Error('public_transport_failed');
 }
 if(Buffer.byteLength(raw)>600*1024)throw Error('public_body_too_large');
 let envelope;try{envelope=JSON.parse(raw);}catch{throw Error('public_invalid_json');}
 if(envelope.ok!==true){const code=envelope.error_code;if(!/^(public_http_[0-9]{3}|public_body_too_large|invalid_public_request|public_network_error)$/.test(code||''))throw Error('public_transport_failed');throw Error(code);}
 if(envelope.data?.status!=='1'||!Array.isArray(envelope.data.pois)||envelope.data.pois.length>20)throw Error('public_invalid_poi');
 if(envelope.transport)Object.defineProperty(envelope.data,'_transport',{value:envelope.transport,enumerable:false});
 return envelope.data;
}
