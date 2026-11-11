import handler from '../beijing-food-map/amap-handler.cjs';
import html from '../beijing-food-map/index.html';
import samples from '../beijing-food-map/samples.js?raw';
import prototype from '../beijing-food-map/prototype.js?raw';
import contentHtml from '../content/index.html';
import contentScript from '../content/app.js?raw';
import contentStyle from '../content/style.css?raw';
import homeCards from '../content/home-cards.js?raw';
import homeStyles from '../content/home-cards.css?raw';

const assets = {'index.html': html, 'samples.js': samples, 'prototype.js': prototype};
Object.assign(assets,{'content/index.html':contentHtml,'content/app.js':contentScript,'content/style.css':contentStyle});
Object.assign(assets,{'content/home-cards.js':homeCards,'content/home-cards.css':homeStyles});
const release = typeof FOODMAP_RELEASE === 'string' ? FOODMAP_RELEASE : 'development';

export default {
  async fetch(request, env = {}) {
    if (new URL(request.url).pathname === '/healthz') {
      return Response.json({status: 'ok', application: 'beijing-food-map', release}, {
        headers: {'Cache-Control': 'no-store'}
      });
    }
    return handler.createHandler({
      serviceKey: env.AMAP_WEB_SERVICE_KEY,
      jsKey: env.AMAP_JS_KEY,
      securityCode: env.AMAP_JS_SECURITY_CODE,
      readAsset: file => assets[file]
    })(request);
  }
};
