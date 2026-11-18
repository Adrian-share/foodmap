const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
test('metadata display omits other collection videos but preserves current description and raw hash',async()=>{
 const {modelToolResult}=await import('../agent/pi/model-view.mjs');const context={bvid:'BV1NG6kYTEXG',creator_uid:'123',evidence:{metadata:{kind:'metadata'}}};
 const raw={code:0,data:{bvid:context.bvid,owner:{mid:123},desc:'current description',pages:[{page:1,cid:123}],ugc_season:{sections:[{episodes:[{desc:'other-video-description'}]}]}}};
 const bytes=JSON.stringify(raw),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const view=modelToolResult('content_fetch_metadata',{}, {evidence_id:'metadata',payload:raw,sha256:hash},context);
 assert.equal(view.model_view.data.desc,'current description');assert.equal(view.sha256,hash);assert(!JSON.stringify(view).includes('other-video-description'));assert.equal(JSON.stringify(raw),bytes);
 const read=modelToolResult('content_read_evidence',{evidence_id:'metadata'},{text:bytes,sha256:hash},context);assert.equal(read.sha256,hash);assert(!read.text);
});
test('frame sampling stops after three new captures and one proposal ends sampling',async()=>{
 const {executeTool}=await import('../agent/pi/tool-core.mjs');const dir=await fs.mkdtemp(path.resolve('tests/agent/cache-'));let calls=0;const previousFetch=global.fetch;global.fetch=async()=>{throw Error('offline test');};
 try{const c={root:dir,task_id:crypto.randomUUID(),bvid:'BV1NG6kYTEXG',creator_uid:'3546728118618546',part:1,evidence:{}};
 const invoke=t=>executeTool('content_capture_frame',{task_id:c.task_id,bvid:c.bvid,part:1,timestamp_ms:t},c,undefined,{captureFrame:async()=>{calls++;return {status:'blocked_capture'};}});
 for(const t of [1,2,3])await invoke(t);assert.equal((await invoke(4)).reason,'frame_sampling_budget_exhausted');assert.equal(calls,3);
 c.proposal_submitted=true;assert.equal((await invoke(5)).status,'proposal_already_submitted');assert.equal(calls,3);
 }finally{global.fetch=previousFetch;await fs.rm(dir,{recursive:true,force:true});}
});
test('registered original frame cache reuses exact bytes without another media request',async()=>{
 const {register,captureFrame}=await import('../agent/pi/adapters.mjs');const {png,sha}=require('./fixtures/publication.cjs');
 const dir=await fs.mkdtemp(path.resolve('tests/agent/cache-')),original=global.fetch;
 try{const c={root:dir,bvid:'BV1NG6kYTEXG',creator_uid:'3546728118618546',part:1,evidence:{},metadata_cached:true};
 await register(c,'metadata','metadata',{code:0,data:{bvid:c.bvid,owner:{mid:c.creator_uid},pages:[{page:1,cid:123,duration:60}]}},'https://api.bilibili.com/x/web-interface/view?bvid='+c.bvid);
 const bytes=png(),hash=sha(bytes),file='frame-'+hash+'.png';await fs.writeFile(path.join(dir,file),bytes);c.frame_files={[hash]:{file,sha256:hash}};
 await register(c,'frame:2000','frame',{bvid:c.bvid,part:1,cid:123,timestamp_ms:2000,actual_timestamp_ms:2000,sha256:hash,bytes:bytes.length,mime_type:'image/png',width:64,height:64,mean:120,stddev:40,capture_method:'official-stream-pipe'},'https://www.bilibili.com/video/'+c.bvid+'/');
 global.fetch=async()=>{throw Error('must not refetch registered metadata/media');};
 const r=await captureFrame(c,{timestamp_ms:2000});assert.equal(r.status,'captured');assert.equal(r.cache_hit,true);assert.equal(r.payload.sha256,hash);
 await fs.writeFile(path.join(dir,file),'corrupt');assert.notEqual((await captureFrame(c,{timestamp_ms:2000})).status,'captured');
 }finally{global.fetch=original;await fs.rm(dir,{recursive:true,force:true});}
});
test('metadata cache keeps evidence identity stable and still checks owner and part',async()=>{
 const {register,metadata}=await import('../agent/pi/adapters.mjs');const dir=await fs.mkdtemp(path.resolve('tests/agent/cache-')),original=global.fetch;
 try{
  const c={root:dir,bvid:'BV1NG6kYTEXG',creator_uid:'123',part:1,evidence:{}};
  const payload={code:0,data:{bvid:c.bvid,owner:{mid:123},pages:[{page:1,cid:123,duration:60}]}};
  const first=await register(c,'metadata','metadata',payload,'https://api.bilibili.com/x/web-interface/view?bvid='+c.bvid),entry=structuredClone(c.evidence.metadata);
  global.fetch=async()=>{throw Error('must not refetch');};
  for(let i=0;i<3;i++){const r=await metadata(c,{include_subtitles:false});assert.equal(r.sha256,first.sha256);assert.deepEqual(c.evidence.metadata,entry);}
  await assert.rejects(()=>metadata({...c,creator_uid:'999'},{include_subtitles:false}),/owner/);
  await assert.rejects(()=>metadata({...c,part:2},{include_subtitles:false}),/owner/);
  c.evidence.metadata.checked_at='2000-01-01T00:00:00Z';await assert.rejects(()=>metadata(c,{include_subtitles:false}),/must not refetch/);
 }finally{global.fetch=original;await fs.rm(dir,{recursive:true,force:true});}
});
