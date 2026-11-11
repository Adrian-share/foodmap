const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {assess,validScreenshot}=require('../content/catalog.cjs');
const {createContentState}=require('../content/state.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function buildContent(root=path.join(__dirname,'..')){
  const config=JSON.parse(fs.readFileSync(path.join(root,'content/config.json'),'utf8'));
  if(!Array.isArray(config.batches)||!Array.isArray(config.creator_uids)||config.creator_uids.some(uid=>!/^\d+$/.test(uid)))throw Error('批次或 UID 配置无效');
  const base=JSON.parse(fs.readFileSync(path.join(root,'data/catalog.json'),'utf8'));
  const aliases=Object.entries(config.store_aliases||{});
  if(new Set(aliases.map(([,id])=>id)).size!==aliases.length)throw Error('一个旧门店不能映射多个 POI');
  for(const [poi,id] of aliases){
    if(!base.shops.some(s=>s.id===id&&(!s.amap_poi_id||s.amap_poi_id===poi)))throw Error('旧门店映射不存在或 POI 冲突：'+id);
    if(base.shops.some(s=>s.amap_poi_id===poi&&s.id!==id))throw Error('POI 已对应另一旧门店：'+poi);
  }
  const batches=[],seen=new Map(),assets={};
  for(const entry of config.batches){
    if(entry.enabled===false)continue;
    if(!/^batches\/[A-Za-z0-9_-]+\.json$/.test(entry.path))throw Error('无效批次路径');
    const batch=JSON.parse(fs.readFileSync(path.join(root,'content',entry.path),'utf8'));
    if(batch.enabled===false)continue;
    if(typeof batch.batch_id!=='string'||!batch.batch_id||typeof batch.version!=='string'||!batch.version||!Array.isArray(batch.records)||!batch.created_at||!batch.source_list||!batch.inventory)throw Error('批次头不完整：'+entry.path);
    for(const r of batch.records){
      if(!r?.creator||!r.video||!r.visit||!r.review)throw Error('记录缺少 creator/video/visit/review：'+entry.path);
      if(base.shops.some(s=>s.id===r.visit.store_id)&&config.store_aliases?.[r.visit.amap_poi_id]!==r.visit.store_id)throw Error('引用旧门店必须配置 POI 映射：'+r.visit.store_id);
    }
    const signature=JSON.stringify(batch);
    if(seen.has(batch.batch_id)){
      if(seen.get(batch.batch_id)!==signature)throw Error('批次 ID 冲突：'+batch.batch_id);
      continue;
    }
    seen.set(batch.batch_id,signature);
    // Private capture notes stay in source batches; runtime only needs API fields.
    batches.push({batch_id:batch.batch_id,version:batch.version,records:batch.records.map(r=>({creator:r.creator,video:r.video,visit:r.visit,review:r.review}))});
    for(const r of batch.records){
      if(assess(r,config).length)continue;
      for(const i of r.visit.screenshots||[]){
        if(!validScreenshot(r,i))continue;
        const file=path.join(root,i.path),bytes=fs.readFileSync(file),sha256=hash(bytes);
        if(sha256!==i.sha256)throw Error('截图哈希不一致：'+i.path);
        const ext=path.extname(file).slice(1),type='image/'+(ext==='jpg'?'jpeg':ext);
        const signatures={jpeg:bytes[0]===255&&bytes[1]===216,png:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'};
        if(!signatures[type.slice(6)])throw Error('图片文件内容无效：'+i.path);
        assets['/'+i.path]={sha256,type,base64:bytes.toString('base64')};
      }
    }
  }
  batches.sort((a,b)=>a.batch_id.localeCompare(b.batch_id));
  const runtimeConfig={creator_uids:[...new Set(config.creator_uids)].sort(),store_aliases:Object.fromEntries(aliases.sort())};
  const version=batches.map(b=>b.batch_id+':'+b.version).join(',')+'@'+hash(JSON.stringify({batches,config:runtimeConfig})).slice(0,16);
  const snapshot={version,config:runtimeConfig,batches};
  const state=createContentState(snapshot,assets);
  fs.writeFileSync(path.join(root,'content/public-assets.json'),JSON.stringify(assets,null,2)+'\n');
  fs.writeFileSync(path.join(root,'content/compiled.json'),JSON.stringify(snapshot,null,2)+'\n');
  return {version,batches:state.batches,approved:state.catalog.visits.length,shops:state.catalog.shops.length,public_images:Object.keys(assets).length};
}
if(require.main===module)console.log(JSON.stringify(buildContent()));
module.exports={buildContent};
