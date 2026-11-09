const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const manifest = require('./assets/images/manifest.json');
const {restaurants} = require('./samples.js');

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
if (images.size !== restaurants.length || !restaurants.every(shop => images.has(shop.name))) {
  throw new Error('每家样本门店必须恰有一张来源明确的图片');
}

function withImage(shop, baseUrl) {
  const image = images.get(shop.name);
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
  return `### ${shop.name}\n\n直线距离：${(shop.meters / 1000).toFixed(2)} km\n\n` +
    `![${shop.image.alt}](${shop.image.url})\n\n图片：原探店视频封面 · [图片出处](${shop.image.source})\n\n` +
    `[探店出处](${shop.source}) · [B站视频](${shop.video})\n`;
}

function imageContent(shops) {
  return shops.flatMap(shop => [{type:'text', text:caption(shop)},
    {type:'image', data:images.get(shop.name).bytes.toString('base64'), mimeType:'image/jpeg'}]);
}

module.exports = {withImage, imageForPath, caption, imageContent};
