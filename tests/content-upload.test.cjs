'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {buildPayload, uploadInventory} = require('../scripts/upload-creator-inventory.cjs');
const run = {run_id:'acceptance-run',checked_at:'2026-11-16T00:00:00Z',outcome:'partial',new_candidates:[]};
const snapshot = {schema:1,updated_at:run.checked_at,discoveries:[],accounts:[],seasons:[],videos:[],failures:{}};
const receipt = {revision:1,discovered_count:0,last_run:run};
test('S4 上传丢弃本机失败状态和未验证元数据，保留核实的官方候选',()=>{
 const body=buildPayload({...snapshot,videos:[{owner_verified:false},{owner_verified:true,bvid:'BV1NG6kYTEXG',description:'extra'}]},run);
 assert.equal(body.snapshot.videos.length,1);
 assert.equal(body.snapshot.failures,undefined);
 assert.equal(body.snapshot.videos[0].description,undefined);
 assert.throws(()=>buildPayload(snapshot,{...run,dry_run:true}));
});
test('S4 候选上传必须真实200，并用同一认证读取持久回执',async()=>{
 const calls=[];
 const options={url:'https://foodmap.test',token:'acceptance-secret',transport:async request=>{
  calls.push(request);return {status:200,body:JSON.stringify(receipt)};
 }};
 assert.equal((await uploadInventory(buildPayload(snapshot,run),options)).uploaded,true);
 assert.deepEqual(calls.map(c=>c.method),['POST','GET']);
 assert.ok(calls.every(c=>c.token==='acceptance-secret'));
 const rejected={...options,transport:async()=>({status:403,body:'challenge'})};
 await assert.rejects(uploadInventory(buildPayload(snapshot,run),rejected),/HTTP 403/);
});
test('S4 读取旧版本或缺失回执不能报告上传完成',async()=>{
 let calls=0;
 const options={url:'https://foodmap.test',token:'secret',transport:async()=>({status:200,body:JSON.stringify({...receipt,revision:++calls===1?2:1})})};
 await assert.rejects(uploadInventory(buildPayload(snapshot,run),options),/持久读取/);
 await assert.rejects(uploadInventory(buildPayload(snapshot,run),{...options,transport:async()=>({status:200,body:'{}'})}),/缺少版本/);
});
