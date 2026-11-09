const origins = {
  '王府井': {name:'王府井地铁站', lng:116.411571, lat:39.908069, source:'https://ditu.amap.com/place/BV10006496'},
  '东坝': {name:'东坝地铁站', lng:116.547126, lat:39.965732, source:'https://ditu.amap.com/place/BV09269671'},
  '大钟寺': {name:'大钟寺地铁站', lng:116.345139, lat:39.966612, source:'https://ditu.amap.com/place/BV10001016'}
};
const restaurants =
[
  {
    "name": "泰丰楼",
    "address": "西城区 · 大栅栏 · 前门西大街2号楼",
    "lng": 116.391816,
    "lat": 39.899823,
    "source": "https://tanwei.org/nearby/poi/6e490356-c4fc-5253-a35f-5fd5a2084d6b",
    "video": "https://www.bilibili.com/video/BV1CB4y147BG/"
  },
  {
    "name": "北京宜宾招待所·餐厅",
    "address": "西城区 · 宣武门 · 西中胡同28号(宁波宾馆南门斜对面)",
    "lng": 116.379692,
    "lat": 39.901244,
    "source": "https://tanwei.org/nearby/poi/dee9d940-a171-5010-a6c2-5145857abd91",
    "video": "https://www.bilibili.com/video/BV1wT1WYxEjC/"
  },
  {
    "name": "潇湘阁（三里屯SOHO店）",
    "address": "朝阳区 · 三里屯 · 北京城区三里屯SOHO1号商场B1-117/下沉广场赛百味路口往里走30米",
    "lng": 116.452883,
    "lat": 39.933123,
    "source": "https://tanwei.org/nearby/poi/ca7d347b-2d77-5697-9b9f-3206d9c86a05",
    "video": "https://www.bilibili.com/video/BV1Lh4y1d7U5/"
  },
  {
    "name": "老吉堂·吉来（正大中心店）",
    "address": "朝阳区 · 大望路 · 金和东路20号院1号楼正大中心3层302b",
    "lng": 116.468365,
    "lat": 39.912794,
    "source": "https://tanwei.org/nearby/poi/223dbb83-1fba-5e97-9b9c-e0c3eee7ab26",
    "video": "https://www.bilibili.com/video/BV1D64y1K7uj/"
  },
  {
    "name": "富春居（北京璞瑄酒店店）",
    "address": "东城区 · 灯市口 · 王府井大街1号璞瑄酒店3层",
    "lng": 116.410001,
    "lat": 39.923532,
    "source": "https://tanwei.org/nearby/poi/2fe17929-0c75-575d-9364-9ebd5aa55b87",
    "video": "https://www.bilibili.com/video/BV1144y1G7Fo/"
  },
  {
    "name": "同和居（月坛店）",
    "address": "西城区 · 月坛 · 月坛南街甲71号",
    "lng": 116.34003,
    "lat": 39.914177,
    "source": "https://tanwei.org/nearby/poi/99d4510f-963a-5f9c-8306-38862d706524",
    "video": "https://www.bilibili.com/video/BV1Dg411j73k/"
  },
  {
    "name": "寂川（西大望路店）",
    "address": "朝阳区 · 大望路 · 西大望路甲2号航空大厦F1层",
    "lng": 116.478297,
    "lat": 39.915326,
    "source": "https://tanwei.org/nearby/poi/3b2babea-c3df-519b-b75a-d79e38fdb215",
    "video": "https://www.bilibili.com/video/BV1ma411v7V1/"
  },
  {
    "name": "聚德楼饭庄（劲松店）",
    "address": "朝阳区 · 劲松 · 东三环南路乙52号1层(劲松地铁站B东北口步行370米)",
    "lng": 116.462054,
    "lat": 39.886822,
    "source": "https://tanwei.org/nearby/poi/443febbf-8eae-56ab-a2cb-063fb5c2b3fa",
    "video": "https://www.bilibili.com/video/BV1aj411A7Bg/"
  },
  {
    "name": "砂锅居（西四店）",
    "address": "西城区 · 西四 · 北京城区西四南大街60号(西四地铁站D西南口步行340米)",
    "lng": 116.373779,
    "lat": 39.920459,
    "source": "https://tanwei.org/nearby/poi/19f5c885-3479-5f51-a00f-8e380f359df0",
    "video": "https://www.bilibili.com/video/BV1ka411n7Nd/"
  },
  {
    "name": "洪福亮酒家（南草厂街店）",
    "address": "西城区 · 官园 · 北京城区南草厂街91号",
    "lng": 116.363946,
    "lat": 39.936263,
    "source": "https://tanwei.org/nearby/poi/813b0459-44a7-5bfa-a3a4-f79ad8ec6c78",
    "video": "https://www.bilibili.com/video/BV1LY4y1k7LX/"
  }
]
;

function normalize(query) {
  return query.trim().replace(/^北京(?:市)?\s*/, '').replace(/望府井/g, '王府井');
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

const samples = {origins, restaurants, normalize, resolveFixture, closest};
if (typeof module !== 'undefined') module.exports = samples;
