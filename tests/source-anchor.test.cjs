// Offline source mutations only. Live evidence is captured separately.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourcePage}=require('../scripts/agent-source-page.cjs');
const uid='3546728118618546',sid='5780378',anchor='BV1NG6kYTEXG',next='BV1abcde2345';
const source={uid,type:'season',id:sid,anchor_bvid:anchor};
function syntheticBV(i){const a="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let x="";do{x=a[i%58]+x;i=Math.floor(i/58);}while(i);return "BV"+x.padStart(10,"a");}
function payload(count=2){return {code:0,data:{bvid:anchor,owner:{mid:uid},ugc_season:{id:Number(sid),mid:uid,ep_count:count,sections:[{episodes:Array.from({length:count},(_,i)=>({bvid:i===0?anchor:i===1?next:syntheticBV(i),arc:{title:'offline',author:{mid:uid}}}))}]}}};}
test('two approved Beijing collections retain per-account bindings and bounded 114-item pages',async()=>{
 for(const a of [{uid:'3546888255048212',id:'5622142',bvid:'BV1fzhM6iE5k',count:13},{uid:'1781681364',id:'956796',bvid:'BV1d94y1j7Ag',count:114}]){
  const s={uid:a.uid,type:'season',id:a.id,anchor_bvid:a.bvid};let calls=0;
  const fake=async()=>{calls++;const p=payload(a.count);p.data.bvid=a.bvid;p.data.owner.mid=a.uid;p.data.ugc_season.id=Number(a.id);p.data.ugc_season.mid=a.uid;p.data.ugc_season.sections[0].episodes.forEach(e=>e.arc.author.mid=a.uid);p.data.ugc_season.sections[0].episodes[0].bvid=a.bvid;return {status:200,json:async()=>p};};
  const first=await sourcePage({source:s,page:1},fake);assert.equal(first.items.length,Math.min(100,a.count));assert(first.items.every(e=>e.uid===a.uid));
  if(a.count>100){const second=await sourcePage({source:s,page:2},fake);assert.equal(second.items.length,14);assert.equal(second.reached_end,true);assert.equal(calls,2);assert.equal(first.collection.list_sha256,second.collection.list_sha256);}
  await assert.rejects(()=>sourcePage({source:{...s,uid:uid},page:1},fake));
 }
});
test('registered season anchor consumes the collection, not single BV metadata',async()=>{
 const seen=[];const r=await sourcePage({source,page:1},async(url,init)=>{seen.push({url,init});return {status:200,json:async()=>payload()};});
 assert.equal(new URL(seen[0].url).pathname,'/x/web-interface/view');
 assert.equal(new URL(seen[0].url).searchParams.get('bvid'),anchor);
 assert.equal(seen.length,1);assert.deepEqual(r.items.map(i=>i.bvid),[anchor,next]);
 assert(r.items.every(i=>i.uid===uid));assert.equal(r.collection.id,sid);assert.equal(r.collection.reported_total,2);assert.equal(r.collection.read_count,2);
 assert.match(r.collection.payload_sha256,/^[a-f0-9]{64}$/);assert.equal(r.reached_end,true);
 assert.match(seen[0].init.headers['User-Agent'],/^FoodmapContentAgent/);
});
test('wrong owner, wrong collection and metadata-only responses never become collection success',async()=>{
 for(const mutate of [p=>p.data.owner.mid='1',p=>p.data.ugc_season.mid='1',p=>p.data.ugc_season.id=123,p=>p.data.ugc_season.sections[0].episodes[1].arc.author.mid='1',p=>p.data.ugc_season.sections[0].episodes[1].bvid=anchor,p=>delete p.data.ugc_season,p=>p.data.ugc_season.ep_count=3]){
  const p=payload();mutate(p);await assert.rejects(()=>sourcePage({source,page:1},async()=>({status:200,json:async()=>p})));
 }
 await assert.rejects(()=>sourcePage({source:{...source,anchor_bvid:next},page:1},async()=>{throw Error('unapproved request must not happen');}));
});
test('anchor pages and requests remain bounded; ordinary season API stays unchanged',async()=>{
 let calls=0;const fetch=async()=>{calls++;return {status:200,json:async()=>payload(123)};};
 const a=await sourcePage({source,page:1},fetch),b=await sourcePage({source,page:2},fetch);
 assert.equal(a.items.length,100);assert.equal(a.reached_end,false);assert.equal(b.items.length,23);assert.equal(b.reached_end,true);assert.equal(calls,2);
 let ordinary;await sourcePage({source:{uid,type:'season',id:'123'},page:3},async url=>{ordinary=new URL(url);return {status:200,json:async()=>({code:0,data:{meta:{total:60},archives:[]}})};});
 assert.equal(ordinary.pathname,'/x/polymer/web-space/seasons_archives_list');assert.equal(ordinary.searchParams.get('page_num'),'3');
});
