const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const manifest = require('./assets/images/manifest.json');
const catalog = require('./data/catalog.json');
const contentAssets = require('./content/public-assets.json');
const restaurants = catalog.shops.map(s => ({...s,video:catalog.visits.find(v=>v.shop_id===s.id)?.video}));

// Bundled, verified assets keep tool queries offline and independent of CDN hotlink rules.
const images = new Map(manifest.map(image => {
  const shop = restaurants.find(shop => shop.name === image.restaurant);
  if (!shop || shop.video !== image.source || !/^BV[0-9A-Za-z]{10}\.jpg$/.test(image.file)) {
    throw new Error('图片与原始门店或视频出处不匹配');
  }
  const bytes = readFileSync(join(__dirname, 'assets/images', image.file));
  if (bytes.subarray(0, 3).toString('hex') !== 'ffd8ff'
    || createHash('sha256').update(bytes).digest('hex') !== image.sha256) {
    throw new Error('图片完整性校验失败：' + image.restaurant);
  }
  return [image.restaurant, {...image, bytes}];
}));
function withImage(shop, baseUrl) {
  const screenshot=shop.visits?.flatMap(v=>v.record?.visit?.screenshots||[]).find(i=>contentAssets['/'+i.path]?.sha256===i.sha256);
  if(screenshot)return {...shop,image:{url:new URL('/'+screenshot.path,baseUrl).href,source:screenshot.source_video,alt:screenshot.alt,kind:'video_screenshot',timestamp_ms:screenshot.timestamp_ms,usage_basis:screenshot.usage_basis,mime_type:contentAssets['/'+screenshot.path].type,sha256:screenshot.sha256}};
  const image = images.get(shop.name);
  if (!image) return shop;
  return {...shop, image:{
    url:new URL('/images/' + image.file, baseUrl).href,
    original_url:image.original_url, source:image.source, alt:image.alt,
    kind:image.kind, mime_type:image.mime_type, sha256:image.sha256
  }};
}

function imageForPath(path) {
  // Match only catalogued paths; never join any client-controlled path to the filesystem.
  return [...images.values()].find(image => path === '/images/' + image.file);
}

function caption(shop) {
  if(!shop.image)return `### ${shop.name}\n\n直线距离：${(shop.meters/1000).toFixed(2)} km\n\n${shop.address}\n\n[分店出处](${shop.source}) · [原视频](${shop.video})\n\n核对状态：${shop.verification}；${shop.coordinate_note}\n`;
  return `### ${shop.name}\n\n直线距离：${(shop.meters / 1000).toFixed(2)} km\n\n` +
    `![${shop.image.alt}](${shop.image.url})\n\n图片：${shop.image.kind==='video_screenshot'?'原视频真实截图（'+shop.image.timestamp_ms/1000+' 秒）':'原探店视频封面'} · [图片出处](${shop.image.source})\n\n` +
    `[探店出处](${shop.source}) · [B站视频](${shop.video})\n`;
}

function imageContent(shops) {
  return shops.filter(shop=>shop.image).flatMap(shop => [{type:'text', text:caption(shop)},
    {type:'image', data:shop.image.kind==='video_screenshot'?contentAssets[new URL(shop.image.url).pathname].base64:images.get(shop.name).bytes.toString('base64'), mimeType:shop.image.mime_type||'image/jpeg'}]);
}

module.exports = {withImage, imageForPath, caption, imageContent};
