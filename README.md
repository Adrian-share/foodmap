# 双城探店地图

网页和 Codex MCP 共用 `data/catalog.json`、`nearby.cjs` 的地点解析与 Haversine 直线距离排序。一个 HTTP 服务提供网页、`GET /api/nearby`、原视频封面和 Streamable HTTP `POST /mcp`。复用 FACT-4 高德地图、FACT-5 只读工具和图片。原验收代码见提交 `2f725c7`；来源及用户补充的成果目录见 `docs/BASELINES.md`。

## 启动

需要 Node.js 20+：

```sh
npm ci
npm start
```

网页 `http://127.0.0.1:8767/`；MCP `http://127.0.0.1:8767/mcp`。默认固定地点与验收样本，无高德凭据时显示明确标注的离线位置示意。

真实地图：复制 `.env.example` 为 `.env`，配置已授权的三项凭据，然后：

```sh
node --env-file=.env amap-server.cjs
```

`AMAP_JS_KEY` 是 JS API 公钥；`AMAP_JS_SECURITY_CODE`、`AMAP_WEB_SERVICE_KEY` 只用于服务端。安全密钥由沿用的 `/_AMapService` 代理注入，不下发到页面。高德需允许实际访问域名。

| 环境变量 | 值 | 行为 |
| --- | --- | --- |
| `LOCATION_MODE` | `fixture`（默认） | 固定北京王府井、东坝、大钟寺和上海豫园站坐标 |
| `LOCATION_MODE` | `live` | 高德实时地点搜索，限制北京或上海，歧义先选候选 |
| `DATASET` | `fixture`（默认） | 北京十家与上海三家固定验收样本，明示范围 |
| `DATASET` | `verified` | 仅纳入已核实分店；上海候选和 157 食坊退出排名 |

实时地点检索不等于实时门店库存或实时营业。缺凭据、搜索失败、未知地点不会静默回退到其他起点。

## 验收与证据

```sh
npm test                         # 数据、HTTP、真实 MCP 协议、图片、双城一致性
npx playwright install chromium # 首次安装浏览器
npm run test:page                # 模拟 SDK 页面契约，不代表真实底图
npm run test:all                 # 服务与页面回归
node --env-file=.env node_modules/@playwright/test/cli.js test --config playwright.live.config.cjs
npm run test:codex               # 固定样本：实际 Codex 新会话和真实 MCP 调用
node --env-file=.env scripts/codex-acceptance.cjs # LOCATION_MODE=live 时复测实时解析
npm run sources:verify          # 人工触发原视频元数据、上海封面复核，需要联网
```

本轮报告 `docs/DUAL-CITY-VALIDATION.md`；原始日志、Codex JSONL、审计和对话在 `evidence/dual-city/`；最终截图 `test-results/live-王府井.png`、`test-results/live-豫园.png`。旧 `TEST-RESULTS.md`、`VALIDATION.md`、`IMAGE-VALIDATION.md` 和旧 `evidence/codex*` 是原型历史，不代表本轮结果。

固定用例：王府井站 → 富春居 1.72 km、泰丰楼 1.92 km、宜宾招待所餐厅 2.82 km；豫园站 → 上海老饭店 0.31 km、绿波廊 0.46 km、和平饭店龙凤厅 1.25 km。固定距离容差 0.05 km，按未取整的米数排序。

## Codex / WorkBuddy

配置示例 `config/codex.config.toml.example`，或执行：

```sh
codex mcp add dual_city_food_map --url http://127.0.0.1:8767/mcp
```

工具 `find_nearby_food`：必填 `location`，可选 `city`（北京/上海）和 `origin_id`（服务返回的歧义候选 ID）。无位置的新会话先追问，禁止默认起点。歧义先展示城市、行政区和候选，用户确认后查询。结果包含数据版本、样本范围、准确起点和坐标来源、完整分店、米制直线距离、原视频作者及链接。支持真实图片内容块和 Markdown 视频封面。Codex CLI 的接收和 Markdown 输出实测；图形客户端最终渲染需单独验证。WorkBuddy 沿用 `config/workbuddy/mcp.json`，本轮未作该客户端验收。

## 收录边界

门店和视频分别存储，通过 `shop_id` 关联，一家分店可有多次探店。北京十家完整保留，其中 **6 条原视频不属于指定三位 UP 主**：特厨隋卞 5 条、真探高文麒 1 条。保留实际作者和 `source_scope`，不冒充特厨隋坡。

上海四条原视频已核对标题和作者；标题及封面不能证明具体到访分店或营业状态。三家有固定坐标的候选仅进入 `fixture`；和平饭店用酒店点位。157 食坊分店不明，无坐标，退出所有排名。详见 `docs/SOURCE-REVIEW.md`。本轮没有整库抓取探味地图。

## 部署

当前交付为可运行代码与验收证据，尚未部署公网。FACT-3 历史记录显示服务器首页为 Paperclip，缺少 SSH 用户名、端口及探店部署目录；它不能作为本业务上线证据。

目标环境就绪后执行 `npm ci --omit=dev`，用进程管理器注入环境变量启动 `node amap-server.cjs`（默认 `127.0.0.1:8767`，`HOST`、`PORT` 可覆盖）。代理 `/`、`/api/`、`/_AMapService/`、`/images/`、`/mcp` 到同一服务，配置 HTTPS 后用正式地址复验；`GET /health` 为就绪检查。MCP 沿用已验收的 localhost Host/Origin 校验，不能直接假定外部域名已放行，远程访问策略需按目标部署配置。
