const baseline=require('../data/catalog.json');
const {catalogData}=require('../nearby.cjs');
const {withContentCard,imageForRecord}=require('./presentation.cjs');
// Compatibility endpoint; the homepage now uses /api/nearby. Both share this catalog merge.
function homeCatalog(state=require('./runtime.cjs'),baseUrl='http://localhost'){
  const {shops,visits}=catalogData('verified',state.catalog);
  return {version:state.version,baseline_version:baseline.version,shops:shops.filter(s=>s.city==='北京').map(shop=>{
    const related=visits.filter(v=>v.shop_id===shop.id);
    const result=withContentCard({...shop,visits:related,video:related[0]?.video,creator:related[0]?.creator||null,note:null,image:null},baseUrl,state.images);
    if(result.image)result.image={...result.image,url:new URL(result.image.url).pathname};
    return result;
  })};
}
module.exports={homeCatalog,imageForRecord};
