// 只访问指定原视频元数据，不抓取探味整库，不把标题视为分店或营业状态证明。
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
async function main(){
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json')));
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'assets/images/manifest.json')));
  const evidence=[];
  for(const visit of catalog.visits){
    const bvid=visit.video.split('/').filter(Boolean).at(-1);
    const api='https://api.bilibili.com/x/web-interface/view?bvid='+bvid;
    const response=await fetch(api,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error(`${bvid}: HTTP ${response.status}`);
    const payload=await response.json();if(payload.code!==0)throw Error(`${bvid}: API ${payload.code}`);
    const d=payload.data,shop=catalog.shops.find(s=>s.id===visit.shop_id);
    const requested=[3546888255048212,3546728118618546,544336675].includes(d.owner.mid);
    if(!requested&&shop?.city==='上海')throw Error('新增上海原视频作者不在指定三位 UP 主内');
    visit.source_scope=requested?'requested_creator':'inherited_beijing_outside_requested_creators';
    visit.creator=d.owner.name;visit.creator_id=String(d.owner.mid);visit.title=d.title;
    evidence.push({checked_at:new Date().toISOString(),shop_id:shop.id,video:visit.video,metadata_source:api,
      title:d.title,creator:d.owner.name,creator_id:String(d.owner.mid),city:shop.city,source_scope:visit.source_scope,
      verification:shop.verification==='verified'?'北京分店沿用已验收基线，原视频作者本轮复核':'仅核对原视频标题与作者；具体到访分店及营业状态待核实'});
    if(shop.city==='上海'&&shop.fixture_eligible){
      const original=d.pic.replace(/^http:/,'https:');
      if(!/^https:\/\/i[012]\.hdslb\.com\/bfs\/archive\//.test(original))throw Error('未知封面域名');
      const download=original+'@640w_360h_1c.jpg';
      const r=await fetch(download,{signal:AbortSignal.timeout(20000)}),bytes=Buffer.from(await r.arrayBuffer());
      if(!r.ok||bytes.subarray(0,3).toString('hex')!=='ffd8ff')throw Error('封面不是 JPEG');
      const record={restaurant:shop.name,file:bvid+'.jpg',kind:'video_cover',alt:shop.name+' · 原探店视频封面',
        source:visit.video,restaurant_source:shop.source,video_id:bvid,title:d.title,metadata_source:api,
        original_url:original,download_url:download,mime_type:'image/jpeg',bytes:bytes.length,
        sha256:createHash('sha256').update(bytes).digest('hex'),fetched_at:new Date().toISOString()};
      fs.writeFileSync(path.join(root,'assets/images',record.file),bytes);
      const previous=manifest.findIndex(m=>m.restaurant===shop.name);
      if(previous>=0)manifest[previous]=record;else manifest.push(record);
    }
    console.log(`${shop.name}: ${d.owner.name} / ${bvid} 元数据通过`);
  }
  fs.writeFileSync(path.join(root,'data/catalog.json'),JSON.stringify(catalog,null,2)+'\n');
  fs.writeFileSync(path.join(root,'assets/images/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  fs.mkdirSync(path.join(root,'evidence/dual-city'),{recursive:true});
  fs.writeFileSync(path.join(root,'evidence/dual-city/source-verification.json'),JSON.stringify(evidence,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
