const catalog = require('./data/catalog.json');
const {origins, resolveFixture, airDistance} = require('./samples.js');
const cities = {
  北京:{region:'110000',bounds:[115.4,117.6,39.4,41.1]},
  上海:{region:'310000',bounds:[120.8,122.1,30.6,31.9]}
};
function validPoint(p,city) {
  const [left,right,bottom,top]=cities[city]?.bounds || [];
  return Number.isFinite(p.lng)&&Number.isFinite(p.lat)&&p.lng>=left&&p.lng<=right&&p.lat>=bottom&&p.lat<=top;
}
function missingLocation(location) {
  const text=location.trim().replace(/[\s，,。！？?!、]/g,'');
  return !text || /^(?:我)?(?:的)?(?:附近|这里|这儿|周围|周边|在这里|在这儿|所在位置|当前位置|现在的位置)(?:有(?:什么|啥)|有什么好吃的|有什么餐厅|有什么探店餐厅)?$/.test(text);
}
function createNearbyService({mode='fixture',dataset='fixture',serviceKey,request=fetch,audit=()=>{}}={}) {
  if(!['fixture','live'].includes(mode)||!['fixture','verified'].includes(dataset))throw Error('无效数据或地点模式');
  const base={coordinate_system:'GCJ-02',distance_type:'straight_line',dataset,data_version:catalog.version,mode,
    sample_count:10,scope:dataset==='fixture'?'排名仅限当前城市的固定验收样本；上海候选未完成分店和营业状态核对，和平饭店采用酒店点位。':'排名仅限当前城市已核实收录门店。',results:[]};
  async function resolve({location,city,origin_id}={}) {
    if(typeof location!=='string'||location.length>80)return {status:'needs_location',message:'请提供你所在的酒店、地铁站或地标名称。',matches:[]};
    if(missingLocation(location))return {status:'needs_location',message:'请提供你所在的城市、酒店、地铁站或地标名称，再查询附近探店。',matches:[]};
    const explicit=location.match(/^(北京|上海)(?:市)?/)?.[1];
    const station=resolveFixture(location);
    if(city&&!cities[city] || explicit&&city&&explicit!==city || station&&city&&station.city!==city || station&&explicit&&station.city!==explicit) {
      return {status:'location_not_found',message:'城市与地点冲突，请确认城市和准确地名。',matches:[]};
    }
    city=city||explicit||station?.city;
    if(!city)return {status:'needs_location',message:'请补充城市（北京或上海）及准确的酒店、地铁站或地标名称。',matches:[]};
    audit({event:'location_resolve',location,city,source:mode==='fixture'?'sample_fixture':'amap_live'});
    let matches=[];
    if(mode==='fixture')matches=station?[{...station,coordinate_source:'sample_fixture'}]:[];
    else {
      if(!serviceKey)throw Error('高德 Web 服务凭据未配置');
      const url=new URL('https://restapi.amap.com/v5/place/text');
      url.search=new URLSearchParams({key:serviceKey,keywords:station?.name||location.replace(/^(北京|上海)(?:市)?\s*/,''),region:cities[city].region,city_limit:'true',page_size:'10'});
      const r=await request(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!r.ok)throw Error('高德地点检索失败');
      const data=await r.json();if(data.status!=='1'||!Array.isArray(data.pois))throw Error('高德地点检索失败');
      matches=data.pois.flatMap(p=>{
        if(typeof p.location!=='string'||!p.location.includes(','))return [];
        const values=p.location.split(',');if(values.length!==2||values.some(v=>!v.trim()))return [];
        const [lng,lat]=values.map(Number);
        if(!p.name||!validPoint({lng,lat},city))return [];
        const name=p.name.replace(/\(地铁站\)|（地铁站）/g,'地铁站');
        // 明确车站查询不能回退成商场、出入口或其他同名 POI。
        if(station&&(p.typecode!=='150500'||name!==station.name))return [];
        return [{id:p.id||`${city}:${lng},${lat}`,name,lng,lat,city,district:typeof p.adname==='string'?p.adname:'',
          address:[city,p.adname,p.address].filter(v=>typeof v==='string'&&v).join(' · '),
          source:p.id?'https://ditu.amap.com/place/'+p.id:'https://ditu.amap.com',coordinate_source:'amap_live'}];
      });
    }
    if(origin_id)matches=matches.filter(p=>p.id===origin_id);
    return {status:matches.length>1?'ambiguous':matches.length?'ok':'location_not_found',matches,
      message:matches.length>1?'请选择城市、行政区和准确起点。':matches.length?'已确认起点。':'未找到可确认的起点，请补充准确城市与地点。'};
  }
  async function query(input={}) {
    const resolved=await resolve(input);
    if(resolved.status!=='ok')return {...base,status:resolved.status,message:resolved.message,...(resolved.matches.length?{candidates:resolved.matches}:{})};
    const origin=resolved.matches[0];
    const eligible=catalog.shops.filter(s=>s.city===origin.city&&validPoint(s,origin.city)
      &&(s.verification==='verified'||dataset==='fixture'&&s.fixture_eligible));
    const results=eligible.flatMap(shop=>{
      const visits=catalog.visits.filter(v=>v.shop_id===shop.id);
      if(!visits.length)return [];
      return [{...shop,video:visits[0].video,visits,meters:airDistance(origin,shop)}];
    }).sort((a,b)=>a.meters-b.meters||a.id.localeCompare(b.id)).slice(0,3);
    return {...base,status:'ok',origin,results,sample_count:eligible.length,
      scope:dataset==='fixture'?`排名仅限 ${eligible.length} 家 ${origin.city} 固定样本；${origin.city==='上海'?'上海候选未完成分店和营业状态核对，和平饭店采用酒店点位。':'沿用已验收北京门店。'}`:base.scope,
      message:`${origin.city} ${origin.district} ${origin.name}；${mode==='fixture'?'固定样本起点，非实时定位':'高德实时地点检索'}；按直线距离排序。`};
  }
  return {query,resolve};
}
module.exports={createNearbyService,validPoint,missingLocation};
