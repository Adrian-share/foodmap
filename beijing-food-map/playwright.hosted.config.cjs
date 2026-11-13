const {defineConfig} = require('@playwright/test');
const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
const proxy=proxyUrl?new URL(proxyUrl):null;
const launchOptions=proxy?{proxy:{server:proxy.protocol+'//'+proxy.host,username:decodeURIComponent(proxy.username),password:decodeURIComponent(proxy.password)}}:{};
const baseURL = process.env.FOODMAP_DEPLOYMENT_URL;
if (!baseURL || new URL(baseURL).protocol !== 'https:') throw Error('请设置 FOODMAP_DEPLOYMENT_URL 为已发布的 HTTPS 地址');
module.exports = defineConfig({
  testDir: './tests', testMatch: 'live.spec.cjs', workers: 1,
  timeout: 60000, expect: {timeout: 20000}, reporter: 'list',
  outputDir: 'test-results/hosted',
  use: {baseURL, launchOptions, channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: {width: 1440, height: 1000}, trace: 'off', screenshot: 'only-on-failure'}
});
