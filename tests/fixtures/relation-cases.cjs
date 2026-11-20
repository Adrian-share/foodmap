// fixture=true: explicit addresses/components, independent 16-store baseline each time.
const {proof}=require('./store-identity.cjs');
const shops=require('../../data/catalog.json').shops,soho=shops.find(s=>s.id==='beijing-3');
const cases=[
 {name:'same Qianmen branch, new BV/creator',options:{uid:'613814196'},aliases:{OFFLINE_TAIFENG:'beijing-1'},proofs:[proof()],count:16,id:'beijing-1'},
 {name:'Tongzhou distinct street/house without legacy mapping',options:{branchName:'通州店',address:'滨河路52号',district:'通州区',gcj02:{lng:116.65,lat:39.91},officialDescription:true},count:17},
 {name:'same street house 50 versus 2',options:{branchName:'前门东店',address:'前门西大街50号',gcj02:{lng:116.395,lat:39.899823},officialDescription:true},count:17},
 {name:'adjacent same street house 4 versus 2 less than100m',options:{branchName:'前门二店',address:'前门西大街4号',gcj02:{lng:116.39185,lat:39.899823},officialDescription:true},count:17},
 {name:'same SOHO building/floor different unit at same coordinates',options:{storeName:'潇湘阁',branchName:'三里屯B1-118店',address:'三里屯SOHO1号商场B1-118',district:'朝阳区',gcj02:{lng:soho.lng,lat:soho.lat}},count:17},
 {name:'same SOHO building different floor at same coordinates',options:{storeName:'潇湘阁',branchName:'三里屯B2店',address:'三里屯SOHO1号商场B2-117',district:'朝阳区',gcj02:{lng:soho.lng,lat:soho.lat}},count:17},
 {name:'same SOHO complex different building at same coordinates',options:{storeName:'潇湘阁',branchName:'三里屯二号商场店',address:'三里屯SOHO2号商场B1-117',district:'朝阳区',gcj02:{lng:soho.lng,lat:soho.lat}},count:17},
];
module.exports={cases,soho};
