'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');

test('真实CLI收到SIGTERM后合作式释放本轮锁再退出',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-cli-stop-'));
  const lock=path.join(dir,'state.lock'),ready=path.join(dir,'ready');
  const preload=path.join(dir,'preload.cjs');
  const incremental=require.resolve('../scripts/refresh-creator-inventory-incremental.cjs');
  fs.writeFileSync(preload,`const fs=require('fs');require(${JSON.stringify(incremental)}).runIncremental=async({signal}={})=>{fs.writeFileSync(${JSON.stringify(lock)},String(process.pid));fs.writeFileSync(${JSON.stringify(ready)},'ready');const keep=setInterval(()=>{},1000);try{await new Promise((resolve,reject)=>{if(signal?.aborted)reject(signal.reason);else signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});});}finally{clearInterval(keep);fs.unlinkSync(${JSON.stringify(lock)});}};`);
  const env={...process.env,FOODMAP_INGEST_TOKEN:'test-only-stop-token',FOODMAP_AGENT_ENV_FILE:path.join(dir,'not-configured')};
  const child=spawn(process.execPath,['-r',preload,'scripts/refresh-and-upload.cjs'],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.resume();child.stderr.resume();
  t.after(()=>{try{child.kill('SIGKILL');}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  for(let n=0;n<150&&!fs.existsSync(ready);n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(fs.existsSync(ready));child.kill('SIGTERM');
  const result=await closed;
  assert.equal(result.signal,null);assert.equal(result.code,1);
  assert.equal(fs.existsSync(lock),false);
  const fd=fs.openSync(lock,'wx');fs.closeSync(fd);
});
