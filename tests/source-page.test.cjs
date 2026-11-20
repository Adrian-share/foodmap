'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {sourcePage}=require('../scripts/agent-source-page.cjs');
test('W4 structured source adapter pages arbitrary seasons, requires owner verification',async()=>{
 const seen=[];
 const fetch=async url=>{seen.push(url);return {status:200,json:async()=>({code:0,data:{meta:{total:60},archives:Array.from({length:30},()=>({bvid:'BV1NG6kYTEXG',title:'fixture'}))}})};};
 const result=await sourcePage({source:{uid:'123',type:'season',id:'456'},page:1},fetch);
 assert.equal(result.reached_end,false);assert.equal(result.items[0].uid,null);
 assert.match(seen[0],/season_id=456/);assert.match(seen[0],/page_num=1/);
 const final=await sourcePage({source:{uid:'123',type:'season',id:'456'},page:2},fetch);assert.equal(final.reached_end,true);
 for(const source of [{uid:'123;id',type:'season',id:'456'},{uid:'123',type:'bash',id:'id'},{uid:'123',type:'season',id:'https://evil.test'}])await assert.rejects(()=>sourcePage({source,page:1},fetch));
});
