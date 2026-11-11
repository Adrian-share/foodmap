const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests',testMatch:'content-integration.spec.cjs',workers:1,timeout:20000,
  reporter:[['list']],outputDir:'test-results/content-integration',
  use:{baseURL:'http://127.0.0.1:18909',channel:process.env.PLAYWRIGHT_CHANNEL||undefined,screenshot:'only-on-failure'},
  webServer:{command:'node tests/fixtures/content-server.cjs',url:'http://127.0.0.1:18909',reuseExistingServer:false}});
