const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'live.spec.cjs', workers: 1,
  timeout: 45000, expect: {timeout: 15000}, reporter: 'list',
  outputDir: 'test-results/live',
  use: {baseURL: 'http://127.0.0.1:8768', channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: {width: 1440, height: 1000}, trace: 'off', screenshot: 'only-on-failure'},
  webServer: {command: 'node amap-server.cjs', url: 'http://127.0.0.1:8768',
    env: {PORT: '8768', HOST: '127.0.0.1', LOCATION_MODE:'live', DATASET:'fixture'}, reuseExistingServer: false}
});
