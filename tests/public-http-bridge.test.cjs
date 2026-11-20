const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {pathToFileURL}=require('node:url');
test('POI fixed Python child excludes model/upload/SSH credentials and arbitrary argv',async()=>{
 const {readPublicPoi,publicEnvironment}=await import('../agent/pi/public-http.mjs');
 const env=publicEnvironment({HOME:'/home/test',LANG:'zh_CN.UTF-8',TMPDIR:'/tmp',PATH:'/evil',FOODMAP_MODEL_API_KEY:'fixture-model',FOODMAP_INGEST_TOKEN:'fixture-upload',SSH_AUTH_SOCK:'/socket',MULTICA_API_TOKEN:'fixture-platform'});
 assert.deepEqual(Object.keys(env).sort(),['HOME','LANG','PATH','TMPDIR']);assert.equal(env.PATH,'/usr/bin:/bin');
 let request;
 const runner=(file,args,options)=>{assert.equal(file,path.resolve('tools/venv/bin/python'));assert.deepEqual(args,['-I',path.resolve('scripts/agent-public-json.py')]);assert.equal(options.timeout,20000);assert.equal(options.env.FOODMAP_MODEL_API_KEY,undefined);assert.equal(options.env.SSH_AUTH_SOCK,undefined);const p=Promise.resolve({stdout:JSON.stringify({ok:true,data:{status:'1',pois:[{id:'REAL-SHAPE-FIXTURE'}]}})});p.child={stdin:{end:value=>request=JSON.parse(value)}};return p;};
 const result=await readPublicPoi('金家老三饭庄',undefined,runner);assert.equal(result.pois.length,1);assert.deepEqual(request,{operation:'poi',query:'金家老三饭庄'});
});
test('POI 403/404 remain typed failures; neither is turned into an empty result',async()=>{const {readPublicPoi}=await import('../agent/pi/public-http.mjs');for(const status of [403,404]){const runner=()=>{const p=Promise.resolve({stdout:JSON.stringify({ok:false,error_code:'public_http_'+status})});p.child={stdin:{end:()=>{}}};return p;};await assert.rejects(()=>readPublicPoi('北京餐厅',undefined,runner),new RegExp('public_http_'+status));}await assert.rejects(()=>readPublicPoi('x'.repeat(81)),/invalid_poi_query/);});
