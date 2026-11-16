// v9 基线截图脚本（只读 + 生成 evidence/desktop/baseline-v9/ 下的截图，不改源码）。
// 用法：node evidence/desktop/baseline-v9/screenshot-baseline.cjs
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const outDir = __dirname;
const baseURL = 'http://127.0.0.1:8782';
const mockSdk = fs.readFileSync(path.join(repoRoot, 'tests/mock-sdk.js'), 'utf8');
const viewports = [
  { width: 1280, height: 800, tag: '1280' },
  { width: 1440, height: 900, tag: '1440' },
];

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not become ready: ' + url);
}

async function main() {
  const server = spawn('node', ['beijing-food-map/amap-server.cjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: '8782',
      HOST: '127.0.0.1',
      AMAP_WEB_SERVICE_KEY: '',
      AMAP_JS_KEY: '',
      AMAP_JS_SECURITY_CODE: '',
    },
    stdio: 'ignore',
  });

  let browser;
  try {
    await waitForServer(baseURL + '/');
    browser = await chromium.launch();

    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });

      // 与 tests/desktop.spec.cjs 的 setup 一致：替身高德 SDK + 固定配置。
      await page.route('**/api/amap/config', r => r.fulfill({
        json: { jsKey: 'fixture', serviceHost: '/_AMapService', mapEnabled: true, searchEnabled: false },
      }));
      await page.route('https://webapi.amap.com/maps?**', r => r.fulfill({
        contentType: 'text/javascript', body: mockSdk,
      }));
      // 搜索前：拦截 /api/nearby 永不 resolve，页面不渲染任何卡片。
      await page.route('**/api/nearby**', () => {});

      await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
      await page.locator('#map').waitFor({ state: 'attached' });
      await page.waitForFunction(() => document.getElementById('map')?.dataset.ready === 'true', null, { timeout: 10000 });
      await page.locator('#query').waitFor({ state: 'visible' });
      await page.locator('#creator-filter').waitFor({ state: 'visible' });
      await page.screenshot({ path: path.join(outDir, `before-${vp.tag}.png`) });

      // 王府井结果后：放开拦截并触发王府井搜索，等结果卡片出现。
      await page.unroute('**/api/nearby**');
      await page.click('button[data-origin="王府井"]');
      await page.locator('#results > li').first().waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForFunction(() => {
        const img = document.querySelector('#results > li img');
        return img && img.complete && img.naturalWidth > 0;
      }, null, { timeout: 15000 });
      await page.waitForFunction(() => document.getElementById('map')?.dataset.ready === 'true', null, { timeout: 10000 });
      await page.screenshot({ path: path.join(outDir, `wangfujing-${vp.tag}.png`) });

      await page.close();
    }

    console.log('done');
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill('SIGTERM');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
