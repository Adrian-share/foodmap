const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createNearbyService}=require('./nearby.cjs');
const {withContentCard}=require('./content/presentation.cjs');
const {fixture}=require('./tests/fixtures/content.cjs');
const query={location:'王府井',city:'北京'};
test('U2/U3: preserve top-three default; page the same distance order without duplicates',async()=>{
  const service=createNearbyService({dataset:'verified'});
  const old=await service.query(query),first=await service.query({...query,limit:'6'});
  assert.equal(old.results.length,3);assert.equal(first.results.length,6);
  assert.deepEqual(first.results.slice(0,3).map(s=>s.id),old.results.map(s=>s.id));
  const next=await service.query({...query,limit:'6',offset:first.next_offset});
  const all=[...first.results,...next.results];
  assert.equal(new Set(all.map(s=>s.id)).size,first.total);
  assert.equal(all.length,first.total);assert.equal(next.next_offset,null);
  assert.ok(all.every((s,i)=>!i||s.meters>=all[i-1].meters));
});
test('U3/U4: filter before pagination; attribution, screenshot and exact visit follow selected creator',async()=>{
  const {state}=fixture();const service=createNearbyService({dataset:'verified',contentCatalog:state.catalog});
  const result=await service.query({...query,creator:'999999999999',limit:6});
  assert.equal(result.results.length,1);
  const card=withContentCard(result.results[0],'http://localhost',state.images);
  assert.equal(card.card.creator.uid,'999999999999');
  assert.equal(card.card.video.bvid,'BV1ao4y1k75R');
  assert.equal(card.image.source_video,card.card.video.url);
  assert.ok(card.detail_url.includes(encodeURIComponent(card.featured_visit_id)));
  assert.ok(result.creators.length>=2);
  const empty=await service.query({...query,creator:'not-a-creator',limit:6});
  assert.equal(empty.total,0);assert.deepEqual(empty.results,[]);assert.equal(empty.origin.name,'王府井地铁站');
});
test('U3: invalid paging is bounded',async()=>{
  const service=createNearbyService({dataset:'verified'});
  for(const input of [{limit:'-1',offset:'-1'},{limit:'NaN',offset:'NaN'},{limit:'99999999'}]){
    const r=await service.query({...query,...input});assert.ok(r.results.length<=50);assert.ok(r.results.length>0);
  }
});
