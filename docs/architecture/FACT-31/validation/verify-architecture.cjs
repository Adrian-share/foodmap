const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const {test} = require('node:test');
const root = path.resolve(__dirname,'../../../..');
const doc = path.join(root, 'docs/architecture/FACT-31');
const html = fs.readFileSync(path.join(root, 'diagrams/opik-FACT-31-diagram.html'), 'utf8');

test('A1: four sections, offline readable, responsive, protected image dependency', () => {
  assert.equal((html.match(/<section /g)||[]).length,4);
  for(const s of ['现状请求和数据流','目标服务和数据流','现状缺口','关键边界','--no-builtin-tools','agent_settled','private/content-incremental-v1.json','8767/mcp']) assert.ok(html.includes(s),s);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media\(max-width:850px\)/);
  assert.match(html, /@media\(max-width:520px\)/);
  assert.match(html, /integrity="sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H" crossorigin="anonymous"/);
  assert.ok(html.indexOf('真正 Pi') < html.indexOf('<script'));
});

test('A2: copy succeeds, offline failure, null blob and denied clipboard have visible feedback', async () => {
 const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
 for(const scenario of ['success','offline','null_blob','denied']) {
  const state={textContent:''};let writes=0;
  const btn={textContent:'Copy as image',classList:{add(){},remove(){}}};
  const context={document:{getElementById:()=>state},window:{ClipboardItem:class{}},ClipboardItem:class{},navigator:{clipboard:{write:async()=>{if(scenario==='denied')throw Object.assign(new Error('denied'),{name:'NotAllowedError'});writes++;}}},setTimeout:()=>{},html2canvas:async()=>({toBlob:cb=>cb(scenario==='null_blob'?null:{})})};
  if(scenario==='offline') delete context.html2canvas;
  vm.createContext(context);vm.runInContext(source,context);await context.copyAsImage(btn);
  assert.equal(btn.disabled,false);
  assert.equal(writes,scenario==='success'?1:0);
  assert.match(state.textContent,scenario==='success'?/已复制/:/复制失败/);
 }
});

test('A3: evidence table and protocol are delivered', () => {
 for(const f of ['evidence.md','protocol.md','acceptance.md','pi.lock.json','schemas.json','examples.json']) assert.ok(fs.existsSync(path.join(doc,f)),f);
 const evidence=fs.readFileSync(path.join(doc,'evidence.md'),'utf8');
 for(const s of ['入口文件','数据契约','执行位置','状态','21e0aaf','15','92','77'])assert.ok(evidence.includes(s),s);
});

test('A4: frozen schema examples validate and unknown operations / tools fail closed', () => {
 const Ajv = require('ajv/dist/2020');
 const formats = require('ajv-formats');
 const schema=JSON.parse(fs.readFileSync(path.join(doc,'schemas.json')));
 const examples=JSON.parse(fs.readFileSync(path.join(doc,'examples.json')));
 const ajv=new Ajv({allErrors:true,strict:true});formats(ajv);ajv.addSchema(schema);
 for(const e of examples.valid) {
  const check=ajv.getSchema(schema.$id+'#/$defs/'+e.schema);
  assert.ok(check(e.data),JSON.stringify({name:e.name,errors:check.errors}));
 }
 for(const e of examples.invalid) {
  const check=ajv.getSchema(schema.$id+'#/$defs/'+e.schema);
  assert.equal(check(e.data),false,e.name);
 }
});

test('A5: each evidence file reference exists at baseline and initial watchlist preserves 18 UIDs', () => {
 const sources=JSON.parse(fs.readFileSync(path.join(doc,'source-evidence.json')));
 for(const f of sources.files){const bytes=fs.readFileSync(path.join(root,f.path));assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);}
 const w=JSON.parse(fs.readFileSync(path.join(doc,'watchlist.initial.json')));
 const c=JSON.parse(fs.readFileSync(path.join(root,'content/compiled.json')));
 assert.deepEqual(w.sources.map(s=>s.uid).sort(),c.ledger.creators.map(c=>c.uid).sort());
 assert.equal(w.sources.length,18);
 assert.ok(w.sources.find(s=>s.uid==='3546728118618546').season_ids.includes('5780378'));
});
