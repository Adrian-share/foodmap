// New registry bindings, fixed official host, no network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourcePage}=require('../scripts/agent-source-page.cjs');
const {validateWatchlist}=require('../content/watchlist.cjs');
const uid='999123',sid='987654',bv='BV1abcde2345';
const watch=()=>({schema_version:1,city:'北京',sources:[{uid,name:'offline',profile_url:'https://space.bilibili.com/'+uid,enabled:true,collection_scope:'beijing',season_ids:[sid],collection_anchors:[{season_id:sid,bvid:bv}]}]});
const payload=()=>({code:0,data:{bvid:bv,owner:{mid:uid},ugc_season:{id:Number(sid),mid:uid,ep_count:1,sections:[{episodes:[{bvid:bv,arc:{author:{mid:uid},title:'offline'}}]}]}}});
test('versioned collection binding accepted by both registry validators',()=>{
 assert.deepEqual(validateWatchlist(watch()),watch());const {validate}=require('../content/protocol.cjs');const op={schema_version:1,operation:'watchlist.sync',request_id:'11111111-1111-4111-8111-111111111111',github:{repo:'Adrian-share/foodmap',ref:'fact-18/beijing-content-003',path:'content/watchlists/beijing.json',commit_sha:'a'.repeat(40),sha256:'b'.repeat(64),observed_at:'2026-11-20T02:00:00Z'},watchlist:watch(),expected_registry_revision:3};assert.deepEqual(validate('operation',op),op);
 for(const mutate of [w=>w.sources[0].collection_anchors.push({season_id:sid,bvid:bv}),w=>w.sources[0].collection_anchors[0].season_id='1',w=>w.sources[0].collection_anchors[0].bvid='https://evil.test',w=>w.sources[0].collection_anchors[0].uid='1']){const w=watch();mutate(w);assert.throws(()=>validateWatchlist(w));}
});
test('a new versioned anchor fetches a full official list and rejects all identity conflicts',async()=>{
 let count=0;const source={uid,type:'season',id:sid,anchor_bvid:bv};
 const result=await sourcePage({source,page:1},async url=>{count++;assert.equal(new URL(url).hostname,'api.bilibili.com');assert.equal(new URL(url).searchParams.get('bvid'),bv);return {status:200,json:async()=>payload()};});
 assert.equal(count,1);assert.equal(result.collection.read_count,1);assert.equal(result.collection.reported_total,1);assert.equal(result.items[0].uid,uid);
 for(const change of [p=>p.data.bvid='BV1NG6kYTEXG',p=>p.data.owner.mid='1',p=>p.data.ugc_season.mid='1',p=>p.data.ugc_season.id=1,p=>p.data.ugc_season.sections[0].episodes[0].arc.author.mid='1',p=>p.data.ugc_season.ep_count=2]){const p=payload();change(p);await assert.rejects(()=>sourcePage({source,page:1},async()=>({status:200,json:async()=>p})));}
 await assert.rejects(()=>sourcePage({source:{...source,anchor_bvid:'https://evil.test'},page:1},async()=>{throw Error('must not fetch');}));
});
