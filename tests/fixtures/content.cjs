// Synthetic contract data only. This is NOT a verified restaurant or video screenshot.
const {createHash}=require('node:crypto');
const {createContentState}=require('../../content/state.cjs');
const base=require('../../content/batches/beijing-pilot-001.json');
const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrXcAAAAASUVORK5CYII=';
const bytes=Buffer.from(base64,'base64'),sha256=createHash('sha256').update(bytes).digest('hex');
function record({id='visit-a',bvid='BV1k1KN6BEvw',uid=base.records[0].creator.uid,poi='TEST-NEW',part=1,start=10}={}){
  const r=structuredClone(base.records[0]);
  r.creator={uid,name:'接口测试作者（非真实内容）',profile_url:'https://space.bilibili.com/'+uid};
  Object.assign(r.video,{bvid,url:'https://www.bilibili.com/video/'+bvid+'/',owner_uid:uid,title:'接口测试视频（不作为来源证据）',part,duration_seconds:120,metadata_status:'verified'});
  r.visit={id,store_id:'amap:'+poi,store_name:'接口测试店（非真实门店）',branch_name:poi,city:'北京市',district:'东城区',address:'接口测试地址',amap_poi_id:poi,amap_url:'https://ditu.amap.com/place/'+poi,gcj02:{lng:116.411571,lat:39.908069},business_status:'open',start_seconds:start,end_seconds:start+20,
    evidence:[{type:'branch',status:'verified',url:r.video.url,seconds:start},{type:'amap',status:'verified',url:'https://ditu.amap.com/place/'+poi}],
    opinions:[{text:'仅测试描述与同一次到访绑定，不是真实探店观点。',source_video:r.video.url,seconds:start+1}],dishes:[],
    screenshots:[{path:'content/images/contract-test.png',source_video:r.video.url,part,timestamp_ms:(start+1)*1000,alt:'合成测试图片，非视频截图',usage_basis:'仅用于接口测试的合成像素',rights_status:'approved',frame_verified:true,sha256}]};
  r.review={status:'approved',reasons:['测试替身，不得发布为正式内容']};return r;
}
function fixture(){
  const config={creator_uids:[base.records[0].creator.uid,'999999999999'],store_aliases:{}};
  const batch=(id,records)=>({batch_id:id,version:'1',created_at:'2026-11-11T00:00:00Z',source_list:['TEST ONLY'],inventory:{status:'synthetic'},records});
  const batches=[batch('contract-a',[record(),record({id:'branch-b',poi:'TEST-BRANCH',part:2,start:50})]),batch('contract-b',[record({id:'visit-new-author',bvid:'BV1ao4y1k75R',uid:'999999999999',start:40})])];
  const images={'/content/images/contract-test.png':{base64,sha256,type:'image/png'}};
  return {config,batches,images,state:createContentState({config,batches},images),bytes};
}
module.exports={fixture,record};
