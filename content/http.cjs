const runtime=require('./runtime.cjs');
const paths={'/content/':['content/index.html','text/html'],'/content/app.js':['content/app.js','text/javascript'],'/content/style.css':['content/style.css','text/css'],'/content/home-cards.js':['content/home-cards.js','text/javascript'],'/content/home-cards.css':['content/home-cards.css','text/css']};
function createContentHandler({readAsset,state=runtime}={}){
  const {images}=state;
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/content/')&&path!=='/api/content'&&path!=='/api/home/catalog')return null;
    if(!['GET','HEAD'].includes(request.method))return new Response('只支持读取',{status:405});
    const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
    if(path==='/api/home/catalog')return Response.json(require('./home.cjs').homeCatalog(state,url.origin),{headers});
    if(path==='/api/content'){
      const review=url.searchParams.get('review')==='1';
      // 审核清单仅展示来源和缺项；参考图不进入公开资源或接口。
      const published=state.records.filter(r=>r.published);
      let records=(review?state.records:published).map(r=>({...r,visit:!r.published?{...r.visit,screenshots:[]}:r.visit}));
      const id=url.searchParams.get('visit_id');
      if(id){records=records.filter(r=>r.visit_id===id);if(!records.length)return Response.json({error:'未找到到访记录'},{status:404,headers});}
      return Response.json({batch_id:state.batches.length===1?state.batches[0].batch_id:null,batches:state.batches,version:state.version,published_count:published.length,review_mode:review,records},{headers});
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
module.exports={createContentHandler,catalog:runtime.catalog};
