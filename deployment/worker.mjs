import handler from '../beijing-food-map/amap-handler.cjs';
import ingestion from '../content/ingestion.cjs';
import html from '../beijing-food-map/index.html';
import samples from '../beijing-food-map/samples.js?raw';
import prototype from '../beijing-food-map/prototype.js?raw';
import contentHtml from '../content/index.html';
import contentScript from '../content/app.js?raw';
import contentStyle from '../content/style.css?raw';
import homeCards from '../content/home-cards.js?raw';
import homeStyles from '../content/home-cards.css?raw';
import creatorsHtml from '../content/creators.html';
import creatorsScript from '../content/creators.js?raw';
import creatorsStyle from '../content/creators.css?raw';

const assets = {'index.html': html, 'samples.js': samples, 'prototype.js': prototype};
Object.assign(assets,{'content/index.html':contentHtml,'content/app.js':contentScript,'content/style.css':contentStyle});
Object.assign(assets,{'content/home-cards.js':homeCards,'content/home-cards.css':homeStyles});
Object.assign(assets,{'content/creators.html':creatorsHtml,'content/creators.js':creatorsScript,'content/creators.css':creatorsStyle});
const updates = ingestion.createIngestionService();
const sourceCommit=typeof FOODMAP_SOURCE_COMMIT==='string'?FOODMAP_SOURCE_COMMIT:'development';
const release = typeof FOODMAP_RELEASE === 'string' ? FOODMAP_RELEASE : 'development';

export default {
  async fetch(request, env = {}) {
    if (new URL(request.url).pathname === '/healthz') {
      return Response.json({status: 'ok', application: 'beijing-food-map', release,source_commit:sourceCommit}, {
        headers: {'Cache-Control': 'no-store'}
      });
    }
    const ingestResponse = await updates.handle(request, env);
    if (ingestResponse) return ingestResponse;
    const path = new URL(request.url).pathname;
    let contentState;
    const reader=require('../content/read-model.cjs').createReadModel({bucket:env.CONTENT_UPDATES});
    const publication=env.CONTENT_UPDATES?require('../content/publication.cjs').createPublicationService({bucket:env.CONTENT_UPDATES}):null;
    if(!['GET','HEAD'].includes(request.method))return Response.json({error:'method_not_allowed'},{status:405});
    if(publication){const image=await publication.image(request);if(image)return image;}
    try{
      if(path==='/api/content/current'){const pointer=await reader.current();return Response.json(pointer||{data_version:(await reader.state()).version},{headers:{'Cache-Control':'no-store'}});}
      if(path==='/api/content/snapshot')return Response.json(await reader.snapshot(new URL(request.url).searchParams.get('data_version')),{headers:{'Cache-Control':'no-store'}});
      contentState=await reader.state(new URL(request.url).searchParams.get('data_version'));
    }catch(error){return Response.json({error:error.status===409?'version_expired':'snapshot_unavailable'},{status:error.status||503,headers:{'Cache-Control':'no-store'}});}
    if (['/api/admin/creators', '/api/admin/videos', '/api/admin/service-status'].includes(path) && request.method === 'GET' && request.headers.get('oai-authenticated-user-id')) {
      try { const privateState=await updates.privateState(env,contentState);
        contentState={...contentState,ledger:privateState.ledger};
        if(path==='/api/admin/service-status'){const obj=await env.CONTENT_UPDATES?.get('private/service-v1.json');contentState.service_status={service:obj?await obj.json():null,registry_revision:(await require('../content/registry.cjs').readRegistry(env.CONTENT_UPDATES)).value?.registry_revision||0,current_publication:await publication?.current(),accounts:privateState.ledger.creators.map(c=>({uid:c.uid,coverage:c.coverage})),videos:privateState.ledger.videos.filter(v=>v.pipeline_status).map(v=>({bvid:v.bvid,...v.pipeline_status}))};} }
      catch { return ingestion.unavailable(); }
    }
    return handler.createHandler({
      contentState,
      serviceKey: env.AMAP_WEB_SERVICE_KEY,
      jsKey: env.AMAP_JS_KEY,
      securityCode: env.AMAP_JS_SECURITY_CODE,
      readAsset: file => assets[file]
    })(request);
  }
};
