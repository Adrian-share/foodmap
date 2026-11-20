const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',testMatch:['store-identity.spec.cjs','store-relations.spec.cjs'],timeout:20000,workers:1,reporter:[['list']],outputDir:'test-results/store-identity',use:{viewport:{width:1360,height:900},trace:'retain-on-failure'}});
