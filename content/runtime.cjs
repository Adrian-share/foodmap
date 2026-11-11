const {createContentState}=require('./state.cjs');
module.exports=createContentState(require('./compiled.json'),require('./public-assets.json'));
