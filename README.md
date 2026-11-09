# 北京探店地图

输入北京地点，在高德交互式地图上显示起点和十家固定门店中按直线距离排序的最近三家。点击 1–3 号图钉或列表中的店名，可突出对应结果，并在地图信息窗中查看分店地址、距离、探店记录和视频出处。

## 启动

需要 Node.js 20+。在本目录执行：

```sh
npm ci
npm start
```

访问 `http://127.0.0.1:8766/`。没有凭据时显示明确标注的离线位置示意，支持王府井、望府井、东坝、大钟寺；不会把示意图当作真实地图。

要使用真实高德地图，在启动服务的环境中注入：

| 变量 | 用途 | 是否返回浏览器 |
| --- | --- | --- |
| `AMAP_WEB_SERVICE_KEY` | 北京地点搜索和静态图对照 | 否 |
| `AMAP_JS_KEY` | 高德 Web JS SDK 2.0 的公开 Key | 是 |
| `AMAP_JS_SECURITY_CODE` | 与 JS Key 对应的安全密钥 | 否，仅由服务端代理注入 |
| `HOST` | 监听地址，默认 `127.0.0.1`，远程预览可设 `0.0.0.0` | — |
| `PORT` | 端口，默认 `8766` | — |

使用远程预览域名时，在高德控制台配置该域名的 JS Key 白名单。代理和页面必须通过相同域名访问。Web 服务 Key 与 JS Key 是两类凭据，不能互相替代。环境变量修改后需重启服务。

可以参考 `.env.example` 在本机创建 `.env`，填入真实凭据，然后运行：

```sh
node --env-file=.env amap-server.cjs
```

`--env-file` 需要 Node.js 20.6+。`.env` 不进入交付包或版本库。默认 `npm start` 只读取进程环境，不会自动加载 `.env`。

## 测试

```sh
# 数据、排序、离线回归、搜索响应转换和凭据代理
npm test

# 安装测试浏览器（首次需要）
npx playwright install chromium

# 浏览器验收：固定地点响应 + 模拟 SDK，不依赖高德凭据
npm run test:page

# 运行以上两组
npm run test:all

# 真正连接高德：先注入上面三个凭据
npm run test:live
```

若选择 `.env` 文件，可用 `node --env-file=.env node_modules/@playwright/test/cli.js test --config playwright.live.config.cjs` 运行真实地图验收，子服务会继承变量。可选 `PLAYWRIGHT_CHANNEL=chrome` 使用已安装的 Chrome；默认使用 Playwright Chromium。

真实地图测试未拦截任何网络请求。三个凭据缺少任一项时，三条用例会标为 **skipped / 待验证**。测试框架此时的退出码 0 只表示没有执行失败，不能解释为真实地图验收通过。凭据齐全时检查真实 SDK 完成事件、四个图钉均位于视野、列表和详情联动，并使用球面余弦公式独立复算实时距离。自动保存 `test-results/live-王府井.png`、`live-东坝.png`、`live-大钟寺.png` 和对应 JSON；应人工确认截图中底图道路及高德标识正常。实时起点与固定起点坐标均保存在 JSON，供复核差异。

## 本次结果

详见 `TEST-RESULTS.md` 及 `test-results/`。原型基线 7/7 通过；新增页面测试先得到 9/9 失败，再实现高德交互功能。2026-11-10 补齐运行时凭据并完成真实高德验收：数据与服务端 17/17、固定响应页面 9/9、真实地图 3/3 全部通过，本机 P0 验收通过。三个实时起点与固定基准坐标完全一致。

真实地图截图为 `test-results/live-王府井.png`、`live-东坝.png`、`live-大钟寺.png`；已人工检查道路、高德标识、起点、1–3 号图钉和列表同屏可见。`live-*-detail.png` 补充展示点击门店后的地址、距离和出处信息。`fixture-*.png` 仍保留明确的模拟 SDK 标记，用于固定响应测试，和真实截图分别存放。

## 实现与边界

- `samples.js` 与原附件逐字节相同：保留十家门店、GCJ-02 坐标、分店地址和出处。前端始终使用其中的 Haversine 直线距离排序，无额外坐标转换。
- `prototype.js` 使用 `AMap.Map`、`Marker`、`InfoWindow`、`setFitView`；列表和图钉来自同一份前三名结果，视野适配全部四个点。SDK 从高德在线加载。
- 每次搜索先清空旧图钉、详情、候选和列表。请求与候选选择均检查搜索版本，过时响应不能覆盖新结果。歧义时保留候选地址让用户选择；无结果、服务失败、SDK 失败均给出状态并可重试。网络请求有超时。
- `amap-server.cjs` 提供 `/api/amap/config`、`/api/amap/search` 和 `/_AMapService/` 同源代理。配置响应仅公开 JS Key 和可用状态，安全密钥与 Web 服务 Key 只留在服务端。代理目标固定为高德域名，覆盖传入的 key/jscode，不转发浏览器鉴权头。
- 保留原 `/api/amap/status` 和 `/api/amap/map` 静态图对照端点；前端使用交互 SDK。服务仅提供白名单静态文件，不暴露 `.env`、测试日志或项目文件。
- 本轮仅北京地名搜索、十家固定门店、直线距离、交互地图与探店出处。

高德官方参考：[SDK 加载](https://lbs.amap.com/api/javascript-api-v2/guide/abc/load)、[安全密钥与服务端代理](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)、[自定义点标记](https://lbs.amap.com/api/javascript-api-v2/guide/amap-marker/custom-marker)、[信息窗体](https://lbs.amap.com/api/javascript-api-v2/guide/overlays/info-window)。
