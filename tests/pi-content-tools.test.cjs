'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
test('P4 fixed content tools reject foreign task/BV, arbitrary keys, traversal and symlinks',async()=>{
 const {executeTool}=await import('../agent/pi/tool-core.mjs');
 const root=await fs.mkdtemp(path.resolve('tests/agent/tools-'));const task=crypto.randomUUID();const bvid='BV1NG6kYTEXG';
 try{
  const bytes=Buffer.from('fixture evidence');await fs.writeFile(path.join(root,'evidence.txt'),bytes);
  const context={task_id:task,bvid,part:1,creator_uid:'123',root,evidence:{safe:{file:'evidence.txt',sha256:crypto.createHash('sha256').update(bytes).digest('hex')}}};
  const call=(name,args)=>executeTool(name,args,context);
  assert.equal((await call('content_read_evidence',{task_id:task,evidence_id:'safe'})).text,'fixture evidence');
  for(const [name,args] of [['bash',{command:'id'}],['content_read_evidence',{task_id:task,evidence_id:'../outside'}],['content_read_evidence',{task_id:task,evidence_id:'safe',path:'/etc/passwd'}],['content_fetch_metadata',{task_id:task,bvid:'BV1gkxKefEfW',part:1,include_subtitles:false}],['content_read_evidence',{task_id:crypto.randomUUID(),evidence_id:'safe'}]])await assert.rejects(()=>call(name,args));
  await fs.symlink('../outside',path.join(root,'link'));
  context.evidence.bad={file:'link',sha256:'a'.repeat(64)};
  await assert.rejects(()=>call('content_read_evidence',{task_id:task,evidence_id:'bad'}));
  await assert.rejects(()=>call('content_submit_extraction',{task_id:task,extraction:{approved:true}}));
  const proposal={schema_version:1,task_id:task,creator_uid:'999',bvid,part:1,classification:'uncertain',visits:[],missing:['branch'],evidence_ids:['safe']};
  await assert.rejects(()=>call('content_submit_extraction',{task_id:task,extraction:proposal}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
