const runtime=require('./runtime.cjs');
const {publicCreators,publicCollection}=require('./ledger.cjs');
const paths={'/content/':['content/index.html','text/html'],'/content/app.js':['content/app.js','text/javascript'],'/content/style.css':['content/style.css','text/css'],'/content/home-cards.js':['content/home-cards.js','text/javascript'],'/content/home-cards.css':['content/home-cards.css','text/css']};
function createContentHandler({readAsset,state=runtime}={}){
  const {images}=state;
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    const adminPage=path==='/admin/'||path==='/admin/creators/';
    const adminApi=path==='/api/admin/creators'||path==='/api/admin/videos';
    const privateRoute=adminPage||adminApi||((path==='/api/content'||path==='/content/')&&url.searchParams.get('review')==='1');
    const collectionApi=path==='/api/creators'||/^\/api\/creators\/\d+$/.test(path);
    const creatorAsset=path==='/creators/'||['/content/creators.js','/content/creators.css'].includes(path);
    if(!path.startsWith('/content/')&&path!=='/api/content'&&path!=='/api/home/catalog'&&!adminPage&&!adminApi&&!collectionApi&&!creatorAsset)return null;
    if(!['GET','HEAD'].includes(request.method))return new Response('只支持读取',{status:405});
    const headers={'Cache-Control':privateRoute?'private, no-store':'no-store','X-Content-Type-Options':'nosniff',...(privateRoute?{Vary:'oai-authenticated-user-id'}:{})};
    if(privateRoute&&!request.headers.get('oai-authenticated-user-id')){
      const signIn='/signin-with-chatgpt?'+new URLSearchParams({returnTo:url.pathname+url.search});
      if(adminPage||path==='/content/')return new Response(null,{status:302,headers:{...headers,Location:signIn}});
      return Response.json({error:'请先登录',sign_in_url:signIn},{status:401,headers});
    }
    if(adminApi){
      const ledger=state.ledger||{creators:[],videos:[]};
      if(path==='/api/admin/creators')return Response.json({version:state.version,as_of:ledger.as_of,definitions:ledger.definitions,creators:ledger.creators},{headers});
      const uid=url.searchParams.get('uid'),status=url.searchParams.get('status');
      if(uid&&!ledger.creators.some(c=>c.uid===uid))return Response.json({error:'账号不存在'},{status:404,headers});
      if(status&&!['published','pending','excluded'].includes(status))return Response.json({error:'状态无效'},{status:400,headers});
      return Response.json({version:state.version,videos:ledger.videos.filter(v=>(!uid||v.creator_uid===uid)&&(!status||v.status===status))},{headers});
    }
    if(collectionApi){
      const ledger=state.ledger||{creators:[],videos:[]};
      if(path==='/api/creators')return Response.json({version:state.version,creators:publicCreators(ledger)},{headers});
      const data=publicCollection(ledger,path.split('/').pop());return Response.json(data?{version:state.version,...data}:{error:'该博主暂无已公开视频'},{status:data?200:404,headers});
    }
    if(adminPage||creatorAsset){
      const file=adminPage||path==='/creators/'?'content/creators.html':path.slice(1);
      const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html';
      return new Response(request.method==='HEAD'?null:await readAsset(file),{headers:{...headers,'Content-Type':type+'; charset=utf-8'}});
    }
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
