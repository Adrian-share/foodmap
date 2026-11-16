# 探店地图 v9 基线 · 环境准备与基线记录

- 基线提交：`75063cd810637e24f4bb99ac6b0a0c4e78e45ea3`（FACT-13: record v9 live acceptance, coverage and delivery evidence）
- 分支：`agent/dsh-mac-mini/fa18e2fb4b64`
- 记录时间：由 DSH 子代理执行（只做环境准备与基线记录，未改任何源码/样式/测试文件）

## 1. Node / npm 版本

- Node：`v24.21.0`
- npm：`10.9.2`

## 2. 依赖安装

- `npm ci`：**失败**。esbuild 的 postinstall（`node install.js`）在 `spawnSync node_modules/esbuild/bin/esbuild --version` 时返回 `Unknown system error -88`（EBADMACHO，畸形 Mach-O）。这是当前沙箱限制：执行 workspace 内的二进制/脚本失败。
- `npm install`：**同样失败**，原因同上。
- 改用 `npm install --ignore-scripts`：**成功**（added 22 packages，0 vulnerabilities）。跳过了 esbuild 的 install 脚本；esbuild 的可选平台依赖 `@esbuild/darwin-arm64` 未落地，但基线测试命令（`test:desktop` / `test:home`）不依赖 esbuild，不受影响。

## 3. Playwright Chromium

- `npx playwright install chromium`：联网阶段卡住（无输出、未完成），已跳过。
- 缓存浏览器与 Playwright 1.65.0 完全匹配：`playwright-core/browsers.json` 期望 chromium revision `1254`，本机缓存 `~/Library/Caches/ms-playwright/chromium-1254/`（含 `INSTALLATION_COMPLETE` 与 `chrome-mac-arm64`）。
- 直接启动验证通过：`chromium.launch()` 成功，浏览器版本 `158.0.8127.18`。

## 4. 基线测试结果

### `npm run test:desktop`（= `node --test desktop.acceptance.test.cjs && playwright test --config playwright.desktop.config.cjs`）

- 通过 **7**，失败 **0**，退出码 0。
- 明细：
  - `node --test desktop.acceptance.test.cjs`：3 通过，0 失败。
  - `playwright test --config playwright.desktop.config.cjs`（tests/desktop.spec.cjs）：4 通过。

### `npm run test:home`（= `playwright test --config playwright.home.config.cjs && playwright test --config playwright.desktop.config.cjs`）

- 通过 **7**，失败 **0**，退出码 0。
- 明细：
  - `playwright test --config playwright.home.config.cjs`（tests/home-cards.spec.cjs）：3 通过。
  - `playwright test --config playwright.desktop.config.cjs`（tests/desktop.spec.cjs）：4 通过。

> 两个命令的完整 stdout/stderr 摘要：仅有两类无害告警 `Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.`，无任何测试失败或断言错误。

## 5. 基线截图

页面 `http://127.0.0.1:8782/`（`node beijing-food-map/amap-server.cjs`，端口 8782，用完已停）。截图脚本：`evidence/desktop/baseline-v9/screenshot-baseline.cjs`（用 `page.route` 替身高德 SDK、`/api/amap/config` 固定配置，与 `tests/desktop.spec.cjs` 的 setup 一致；「搜索前」用 `**/api/nearby**` 永不 resolve，「王府井结果后」放开拦截并触发王府井搜索）。

| 文件 | 视口 | 状态 |
| --- | --- | --- |
| `before-1280.png` | 1280×800 | 搜索前（搜索框/筛选可见，结果区为空） |
| `wangfujing-1280.png` | 1280×800 | 王府井结果后（图文卡可见，地图 data-ready） |
| `before-1440.png` | 1440×900 | 搜索前（搜索框/筛选可见，结果区为空） |
| `wangfujing-1440.png` | 1440×900 | 王府井结果后（图文卡可见，地图 data-ready） |

4 张 PNG 均已生成，尺寸分别与目标视口一致（已用 `file`/`sips` 校验）。

## 6. 环境问题 / 异常记录

1. **esbuild postinstall EBADMACHO（-88）**：`npm ci` 与 `npm install` 均失败，已用 `npm install --ignore-scripts` 绕过；不影响本次基线测试与截图。
2. **`npx playwright install chromium` 联网卡住**：已跳过，改用缓存浏览器，直接启动验证通过。
3. **测试运行覆盖了 4 个已跟踪的 fixture 截图**（`evidence/desktop/fixture-*.png`、`evidence/desktop/home-cards/{desktop,mobile}-fixture.png`，是测试自身的产物输出）：`git restore` 被沙箱拒绝（无法在 workspace 外的 gitdir 创建 `index.lock`），已改用只读的 `git show HEAD:<path>` 写回还原；当前工作树仅新增 `evidence/desktop/baseline-v9/`。
4. 端口 8782 / 8779 在测试后均已释放，无残留服务。
