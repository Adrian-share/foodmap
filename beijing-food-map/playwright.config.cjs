const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'page.spec.cjs',
  timeout: 15000, expect: {timeout: 3000}, workers: 2,
  reporter: [['list']], outputDir: 'test-results/browser',
  use: {baseURL: 'http://127.0.0.1:8767', channel: process.env.PLAYWRIGHT_CHANNEL || undefined, viewport: {width: 1360, height: 900},
    screenshot: 'only-on-failure', trace: 'retain-on-failure'},
  webServer: {command: 'node amap-server.cjs', url: 'http://127.0.0.1:8767',
    env: {PORT: '8767', HOST: '127.0.0.1', AMAP_WEB_SERVICE_KEY: '', AMAP_JS_KEY: '', AMAP_JS_SECURITY_CODE: ''},
    reuseExistingServer: false}
});
