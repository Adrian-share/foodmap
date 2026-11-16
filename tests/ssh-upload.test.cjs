'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {uploadInventory} = require('../scripts/upload-creator-inventory.cjs');
const token = 'a'.repeat(64);
const run = {run_id:'ssh-acceptance',checked_at:'2026-11-16T08:00:00Z'};
const receipt = {revision:2,discovered_count:1,last_run:run};
const payload = {snapshot:{schema:1},run};

test('refresh CLI 的帮助入口不读取凭据或触发采集',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-help-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const env={...process.env,FOODMAP_AGENT_ENV_FILE:path.join(dir,'missing'),FOODMAP_AGENT_STATE_DIR:path.join(dir,'state')};
  delete env.FOODMAP_INGEST_TOKEN;
  const result=spawnSync(process.execPath,['scripts/refresh-and-upload.cjs','--help'],{env,encoding:'utf8'});
  assert.equal(result.status,0);
  assert.match(result.stdout,/用法/);
  assert.equal(fs.existsSync(env.FOODMAP_AGENT_STATE_DIR),false);
});

test('上传读取本轮固定快照，即使共享构建快照已被下一轮覆盖',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-run-snapshot-'));
  const snapshotFile=path.join(dir,'shared.json'),runSnapshot=path.join(dir,'snapshot.json');
  const snapshot=bvid=>({schema:1,updated_at:run.checked_at,discoveries:[{bvid,creator_uid:'111',owner_verified:true}],accounts:[],seasons:[],videos:[]});
  fs.writeFileSync(snapshotFile,JSON.stringify(snapshot('BVBBBBBBBBBB')));
  fs.writeFileSync(runSnapshot,JSON.stringify(snapshot('BVAAAAAAAAAA')));
  const report={...run,outcome:'new_content',snapshot_file:snapshotFile,run_snapshot_file:runSnapshot,run_dir:dir,runs_dir:dir,new_candidates:[{bvid:'BVAAAAAAAAAA'}]};
  const refreshPath=require.resolve('../scripts/refresh-and-upload.cjs');
  const incremental=require('../scripts/refresh-creator-inventory-incremental.cjs');
  const uploader=require('../scripts/upload-creator-inventory.cjs');
  const oldRun=incremental.runIncremental,oldUpload=uploader.uploadInventory;
  const savedEnv=process.env.FOODMAP_INGEST_TOKEN;
  process.env.FOODMAP_INGEST_TOKEN=token;
  incremental.runIncremental=async()=>report;
  uploader.uploadInventory=async payload=>{
    assert.equal(payload.snapshot.discoveries[0].bvid,'BVAAAAAAAAAA');
    return {...receipt,uploaded:true};
  };
  delete require.cache[refreshPath];
  t.mock.method(console,'log',()=>{});
  t.after(()=>{
    incremental.runIncremental=oldRun;uploader.uploadInventory=oldUpload;
    delete require.cache[refreshPath];
    if(savedEnv===undefined)delete process.env.FOODMAP_INGEST_TOKEN;else process.env.FOODMAP_INGEST_TOKEN=savedEnv;
    fs.rmSync(dir,{recursive:true,force:true});
  });
  await require(refreshPath).refreshAndUpload();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'upload-receipt.json'))).uploaded,true);
});

function stubSsh(t, mode = 'success') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-ssh-test-'));
  const script = `#!${process.execPath}\nlet text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',()=>{const r=JSON.parse(text);if(process.argv.some(a=>a.includes(r.token)))process.exit(9);if(${JSON.stringify(mode)}==='failure'){process.stderr.write(r.token);process.exit(255);}if(r.method==='GET'&&r.body!==null){process.stderr.write('GET body missing');process.exit(8);}console.log(JSON.stringify({status:200,body:JSON.stringify(${JSON.stringify(receipt)})}));});\n`;
  fs.writeFileSync(path.join(dir,'ssh'),script,{mode:0o755});
  const original = process.env.PATH;
  process.env.PATH = dir + path.delimiter + original;
  t.after(()=>{process.env.PATH=original;fs.rmSync(dir,{recursive:true,force:true});});
}

test('SSH 上传使用 stdin 传凭据，GET显式null，完成POST与持久读回',async t=>{
  stubSsh(t);
  const original=global.fetch;
  global.fetch=()=>{throw new Error('Direct HTTP should not run');};
  t.after(()=>{global.fetch=original;});
  const result=await uploadInventory(payload,{url:'https://foodmap.shareworld.fun',token,sshHost:'foodmap-uploader'});
  assert.equal(result.uploaded,true);
  assert.equal(result.revision,2);
});

test('SSH 目标拒绝命令参数注入',async t=>{
  const original=global.fetch;global.fetch=()=>{throw new Error('Direct HTTP should not run');};t.after(()=>{global.fetch=original;});
  await assert.rejects(uploadInventory(payload,{url:'https://foodmap.shareworld.fun',token,sshHost:'-oProxyCommand=bad'}),/SSH目标无效/);
});

test('SSH 失败消息保留退出状态并隐藏stderr凭据',async t=>{
  stubSsh(t,'failure');
  const original=global.fetch;global.fetch=()=>{throw new Error('Direct HTTP should not run');};t.after(()=>{global.fetch=original;});
  await assert.rejects(uploadInventory(payload,{url:'https://foodmap.shareworld.fun',token,sshHost:'foodmap-uploader'}),error=>{
    assert.match(error.message,/255/);
    assert.ok(!error.message.includes(token));
    return true;
  });
});

test('取消SSH上传后等待SSH进程退出再返回失败',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-ssh-cancel-'));
  const pidFile=path.join(dir,'pid');
  fs.writeFileSync(path.join(dir,'ssh'),`#!${process.execPath}\nconst fs=require('fs');process.stdin.resume();process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);});\n`,{mode:0o755});
  const saved=process.env.PATH;process.env.PATH=dir+path.delimiter+saved;
  let pid;
  t.after(()=>{process.env.PATH=saved;if(pid)try{process.kill(pid,'SIGKILL');}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  const controller=new AbortController();
  const done=uploadInventory(payload,{url:'https://foodmap.shareworld.fun',token,sshHost:'foodmap-uploader',signal:controller.signal}).then(()=>null,error=>error);
  for(let n=0;n<150&&!fs.existsSync(pidFile);n++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(fs.existsSync(pidFile));pid=Number(fs.readFileSync(pidFile));controller.abort();
  const error=await Promise.race([done,new Promise(resolve=>setTimeout(()=>resolve(null),300))]);
  assert.ok(error,'取消后上传仍未结束');
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
});

test('远程CLI能读取带真实换行的配置，然后核对持久状态',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'foodmap-config-test-'));
  const state=path.join(dir,'state');fs.mkdirSync(state);
  fs.writeFileSync(path.join(state,'incremental-state.json'),'{broken');
  const config=path.join(dir,'ingest.env');
  fs.writeFileSync(config,'FOODMAP_SITE_URL=https://foodmap.shareworld.fun\nFOODMAP_INGEST_TOKEN='+token+'\nFOODMAP_AGENT_STATE_DIR='+state+'\n');
  const env={...process.env,FOODMAP_AGENT_ENV_FILE:config};
  for(const key of ['FOODMAP_INGEST_TOKEN','FOODMAP_AGENT_STATE_DIR','FOODMAP_SITE_URL'])delete env[key];
  const result=spawnSync(process.execPath,['scripts/refresh-and-upload.cjs'],{env,encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/invalid incremental state/);
  assert.ok(!result.stderr.includes(token));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
});
