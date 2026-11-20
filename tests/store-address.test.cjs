const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseAddress,compareAddresses}=require('../content/store-address.cjs');
const at=(address,district='西城区')=>({address,district});
test('address components, not full-string inequality or distance, determine comparable differences',()=>{
 for(const [old,newer,reason] of [
  ['前门西大街2号楼','前门西大街50号','different_house'],
  ['前门西大街2号楼','前门西大街4号','different_house'],
  ['滨河路52号院1号楼3层302室','滨河路52号院2号楼3层302室','different_building'],
  ['三里屯SOHO1号商场B1-117','三里屯SOHO1号商场B2-117','different_floor'],
  ['三里屯SOHO1号商场B1-117','三里屯SOHO1号商场B1-118','different_unit'],
 ]){const r=compareAddresses(at(old),at(newer));assert.equal(r.relation,'different',old+' / '+newer);assert.equal(r.reason,reason);}
});
test('normalization preserves explicit components and excludes navigation text',()=>{
 assert.equal(compareAddresses(at('西城区 · 西四 · 西四南大街60号(西四地铁站D口步行340米)'),at('西四南大街６０号')).relation,'same_address');
 assert.equal(compareAddresses(at('三里屯SOHO1号商场B1-117/下沉广场赛百味路口往里走30米'),at('三里屯SOHO1号商场负一层117铺')).relation,'same_address');
 assert.equal(compareAddresses(at('金和东路20号院1号楼正大中心3层302b'),at('金和东路２０号院１号楼正大中心F3层302B室')).relation,'same_address');
 assert.equal(parseAddress(at('月坛南街甲71号')).house,'甲71');
});
test('insufficient parents, ambiguous range and missing child components remain unknown',()=>{
 for(const [old,newer] of [
  ['前门西大街2号','前门西大街'],['前门西大街2号','前门西大街2-4号'],
  ['三里屯SOHO1号商场B1-117','三里屯SOHO1号商场B1'],
  ['三里屯SOHO1号商场B1-117','三里屯SOHO1号商场118铺'],
  ['滨河路52号院1号楼3层302室','滨河路52号院3层303室'],
 ])assert.equal(compareAddresses(at(old),at(newer)).relation,'unknown',old+' / '+newer);
});
test('courtyard/building/site hierarchy cannot be compared across missing or conflicting parents',()=>{
 for(const [a,b] of [
  ['前门西大街2号楼3层301室','前门西大街2号院1号楼3层302室'],
  ['滨河路52号院3层301室','滨河路52号院4层402室'],
  ['滨河路52号正大中心1号楼3层301室','滨河路52号航空大厦2号楼4层402室'],
 ])assert.equal(compareAddresses(at(a),at(b)).relation,'unknown');
});
test('explicit numeric components normalize supported Chinese digits; invalid numbers are not different houses',()=>{
 assert.equal(compareAddresses(at('前门西大街123号'),at('前门西大街一二三号')).relation,'same_address');
 assert.equal(compareAddresses(at('前门西大街2号'),at('前门西大街十十号')).relation,'unknown');
});
test('supported floor and unit syntax compose without being mistaken for a street-door range',()=>{
 for(const unit of ['B1-118号铺','B1-118室','负一层118号铺'])assert.equal(compareAddresses(at('三里屯SOHO1号商场B1-117'),at('三里屯SOHO1号商场'+unit)).reason,'different_unit');
 assert.equal(compareAddresses(at('前门西大街2号'),at('前门西大街2-4号')).relation,'unknown');
});

test('named address parents are parsed as names, not global range keywords; unexplained tails stay unknown',()=>{
 assert.equal(compareAddresses(at('滨河路52号1号楼至诚中心3层301室'),at('滨河路52号1号楼至诚中心4层401室')).reason,'different_floor');
 assert.equal(compareAddresses(at('前门西大街2号'),at('前门西大街4号不详')).relation,'unknown');
});
