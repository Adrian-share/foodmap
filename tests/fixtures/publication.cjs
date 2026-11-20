// Synthetic evidence for offline fault injection ONLY. Never upload to production.
const crypto=require('node:crypto');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const bvid='BV1abcde2345',uid='544336675',at='2026-11-16T16:00:00Z';
function input(){
 const source=(id,kind,payload,url)=>({id,kind,payload,sha256:sha(JSON.stringify(payload)),source_url:url,checked_at:at});
 const video='https://www.bilibili.com/video/'+bvid+'/';
 const frame={bvid,part:1,cid:123,timestamp_ms:12000,actual_timestamp_ms:12000,sha256:'f'.repeat(64),capture_method:'official-stream-pipe',mime_type:'image/png',bytes:100,width:64,height:64,mean:120,stddev:40};
 return {checked_at:at,identity:{task_id:'11111111-1111-4111-8111-111111111111',creator_uid:uid,bvid,part:1},pi:{package:'@earendil-works/pi-coding-agent',version:'1.5.2',provider:'ark-coding-plan-cn',model:'doubao-seed-2.1-turbo',session_id:'fixture',settled_aborted:false},
 proposal:{schema_version:1,task_id:'11111111-1111-4111-8111-111111111111',creator_uid:uid,bvid,part:1,classification:'beijing',missing:[],evidence_ids:['meta','subtitle','poi','frame'],visits:[{id:'visit-1',start_seconds:5,end_seconds:30,store_name:'测试餐厅',branch_name:'东城店',address_hint:'测试路1号',poi_candidates:['TESTPOI1'],description:'这道菜口感很好',evidence_ids:['meta','subtitle','poi'],screenshot_ids:['frame']}]},
 sources:[source('meta','metadata',{code:0,data:{bvid,owner:{mid:Number(uid),name:'fixture'},title:'北京探店',pubdate:1700000000,pages:[{page:1,cid:123,duration:60}]}},'https://api.bilibili.com/x/web-interface/view?bvid='+bvid),source('subtitle','subtitle',{bvid,part:1,cid:123,body:[{from:10,to:15,content:'北京市测试餐厅东城店，测试路1号。这道菜口感很好。'}]},'https://aisubtitle.hdslb.com/fixture.json'),source('poi','poi',{status:'1',pois:[{id:'TESTPOI1',name:'测试餐厅(东城店)',cityname:'北京市',adname:'东城区',address:'测试路1号',location:'116.4,39.9'}]},'https://restapi.amap.com/v5/place/text'),source('frame','frame',frame,video)]};
}
class Bucket{
 constructor(){this.values=new Map();this.n=0;this.fail=null;}
 async get(key){const x=this.values.get(key);if(!x)return null;const b=x.bytes;return {key,etag:x.etag,size:b.length,httpMetadata:x.httpMetadata,customMetadata:x.customMetadata,json:async()=>JSON.parse(b.toString()),text:async()=>b.toString(),arrayBuffer:async()=>Uint8Array.from(b).buffer,body:new Blob([b]).stream()};}
 async head(key){return this.get(key);}
 async put(key,body,options={}){if(this.fail?.(key,body))throw Error('injected_failure');const old=this.values.get(key);const c=options.onlyIf;if(c instanceof Headers&&c.get('If-None-Match')==='*'&&old||c?.etagMatches&&c.etagMatches!==old?.etag)return null;const bytes=typeof body==='string'?Buffer.from(body):Buffer.from(body);const etag='e'+(++this.n);this.values.set(key,{bytes,etag,httpMetadata:options.httpMetadata||{},customMetadata:options.customMetadata||{}});return {etag};}
}
module.exports={input,Bucket,sha,at};
function png(seed=50){
 const zlib=require('node:zlib');
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=c&1?(0xedb88320^(c>>>1)):(c>>>1);}return (c^0xffffffff)>>>0;};
 const part=(name,data)=>{const b=Buffer.concat([Buffer.from(name),data]),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(b));return Buffer.concat([len,b,sum]);};
 const head=Buffer.alloc(13);head.writeUInt32BE(64,0);head.writeUInt32BE(64,4);head[8]=8;head[9]=2;
 const rows=Buffer.alloc((64*3+1)*64);for(let y=0;y<64;y++)for(let x=0;x<192;x++)rows[y*193+1+x]=(x*y+seed)%256;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),part('IHDR',head),part('IDAT',zlib.deflateSync(rows)),part('IEND',Buffer.alloc(0))]);
}
module.exports.png=png;
