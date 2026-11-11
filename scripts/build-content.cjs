const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {assess,validScreenshot}=require('../content/catalog.cjs');
const batch=require('../content/batches/beijing-pilot-001.json');
const root=path.join(__dirname,'..'),assets={};
for(const r of batch.records){
  if(assess(r).length)continue;
  for(const i of r.visit.screenshots){
    if(!validScreenshot(r,i))throw Error('截图与探店片段不一致：'+i.path);
    const file=path.join(root,i.path);
    const bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex');
    if(hash!==i.sha256)throw Error('截图哈希不一致：'+i.path);
    const ext=path.extname(file).slice(1),type='image/'+(ext==='jpg'?'jpeg':ext);
    const signatures={jpeg:bytes[0]===255&&bytes[1]===216,png:bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),webp:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'};
    if(!signatures[type.slice(6)])throw Error('图片文件内容无效：'+i.path);
    assets['/'+i.path]={sha256:hash,type,base64:bytes.toString('base64')};
  }
}
fs.writeFileSync(path.join(root,'content/public-assets.json'),JSON.stringify(assets,null,2)+'\n');
console.log(JSON.stringify({batch:batch.batch_id,approved:batch.records.filter(r=>!assess(r).length).length,public_images:Object.keys(assets).length}));
