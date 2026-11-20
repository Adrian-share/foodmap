const {test}=require('node:test'),assert=require('node:assert/strict');const {visit,proof}=require('./fixtures/store-identity.cjs'),{storeRelations}=require('../content/store-identity.cjs');
test('three relation outcomes retain comparable-address reasons without granting aliases',async()=>{
 const same=await visit(),a=storeRelations(same.result.records[0],{OFFLINE_TAIFENG:'beijing-1'}).find(x=>x.store_id==='beijing-1');assert.equal(a.relation,'same');assert.equal(a.reason,'confirmed_poi_or_versioned_alias');
 const unknown=storeRelations(same.result.records[0],{}).find(x=>x.store_id==='beijing-1');assert.equal(unknown.relation,'unknown');assert.equal(unknown.reason,'same_address_without_confirmed_identity');
 const separate=await visit({branchName:'前门二店',address:'前门西大街4号',gcj02:{lng:116.39185,lat:39.899823},officialDescription:true});const b=storeRelations(separate.result.records[0],{}).find(x=>x.store_id==='beijing-1');assert.equal(b.relation,'different');assert.equal(b.reason,'different_house');assert.equal(b.address.old.house,'2');assert.equal(b.address.new.house,'4');
});
test('same known POI with explicit contradictory address cannot override original evidence',async()=>{
 const f=await visit({branchName:'通州店',address:'滨河路52号',district:'通州区',gcj02:{lng:116.65,lat:39.91},officialDescription:true});const r=storeRelations(f.result.records[0],{OFFLINE_TAIFENG:'beijing-1'}).find(x=>x.store_id==='beijing-1');assert.equal(r.relation,'unknown');assert.equal(r.reason,'confirmed_poi_source_conflict');
});
test('same branch visits keep identity; equal coordinate alone does not create a relation',async()=>{
 const f=await visit(),g=await visit({bvid:'BV1abcde2346',uid:'613814196'});const aliases={OFFLINE_TAIFENG:'beijing-1'},before=JSON.stringify(aliases),r=storeRelations(f.result.records[0],aliases,[],g.result.records);assert(r.some(x=>x.relation==='same'));assert.equal(JSON.stringify(aliases),before);
});
