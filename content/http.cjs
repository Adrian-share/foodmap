const batch=require('./batches/beijing-pilot-001.json');
const images=require('./public-assets.json');
const {assess,publicRecords,playerUrl,buildCatalog}=require('./catalog.cjs');
const assetAvailable=i=>images['/'+i.path]?.sha256===i.sha256;
const published=publicRecords(batch.records,assetAvailable);
const catalog=buildCatalog([batch],assetAvailable);
const paths={'/content/':['content/index.html','text/html'],'/content/app.js':['content/app.js','text/javascript'],'/content/style.css':['content/style.css','text/css']};
function createContentHandler({readAsset}={}){
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/content/')&&path!=='/api/content')return null;
    if(!['GET','HEAD'].includes(request.method))return new Response('只支持读取',{status:405});
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(path==='/api/content'){
      const review=url.searchParams.get('review')==='1';
      // 审核清单仅展示来源和缺项；参考图不进入公开资源或接口。
      const records=(review?batch.records:published).map(r=>({creator:r.creator,video:r.video,visit:review?{...r.visit,screenshots:[]}:r.visit,review:r.review,publication_reasons:assess(r),player_url:playerUrl(r),published:published.includes(r)}));
      return Response.json({batch_id:batch.batch_id,version:batch.version,published_count:published.length,review_mode:review,records},{headers});
    }
    if(Object.hasOwn(paths,path)){
      const [file,type]=paths[path];return new Response(request.method==='HEAD'?null:await readAsset(file),{headers:{...headers,'Content-Type':type+'; charset=utf-8'}});
    }
    const i=images[path];if(i){
      const bytes=Uint8Array.from(atob(i.base64),c=>c.charCodeAt(0));
      return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'Content-Type':i.type,'Content-Length':String(bytes.length)}});
    }
    return new Response('未找到资源',{status:404,headers});
  };
}
module.exports={createContentHandler,catalog};
