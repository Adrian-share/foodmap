const origins = {
  '王府井': {name:'王府井地铁站', lng:116.411571, lat:39.908069, source:'https://ditu.amap.com/place/BV10006496'},
  '东坝': {name:'东坝地铁站', lng:116.547126, lat:39.965732, source:'https://ditu.amap.com/place/BV09269671'},
  '大钟寺': {name:'大钟寺地铁站', lng:116.345139, lat:39.966612, source:'https://ditu.amap.com/place/BV10001016'}
};
// 门店与视频只存一份，由两个入口的共享服务读取。
const catalog = require('./data/catalog.json');
const restaurants = catalog.shops.filter(s => s.city === '北京').map(s => ({...s,
  video: catalog.visits.find(v => v.shop_id === s.id).video}));
Object.entries(origins).forEach(([key, origin]) => Object.assign(origin, {
  id: key, city:'北京', district:key === '王府井' ? '东城区' : key === '大钟寺' ? '海淀区' : '朝阳区'
}));
origins['豫园'] = {id:'BV10030419', name:'豫园地铁站', city:'上海', district:'黄浦区',
  lng:121.487426, lat:31.228005, source:'https://ditu.amap.com/place/BV10030419'};

function normalize(query) {
  return query.trim().replace(/^(?:北京|上海)(?:市)?\s*/, '').replace(/望府井/g, '王府井');
}

function resolveFixture(query) {
  const key = normalize(query).replace(/(?:地铁)?站$/, '');
  return Object.hasOwn(origins, key) ? origins[key] : undefined;
}

function airDistance(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const lat = radians(b.lat - a.lat);
  const lng = radians(b.lng - a.lng);
  const arc = Math.sin(lat / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lng / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(arc)));
}

function closest(origin, shops, distance = airDistance) {
  return shops.map(shop => ({...shop, meters: distance(origin, shop)}))
    .sort((a, b) => a.meters - b.meters)
    .slice(0, 3);
}

const samples = {origins, restaurants, normalize, resolveFixture, closest, airDistance};
if (typeof module !== 'undefined') module.exports = samples;
