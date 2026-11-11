# 内容模块接口契约与 FACT-9 验证

直接执行：开发基线为 FACT-8 已推送提交 `4f1cb94`（其线上源码为 `6875164`）。本变更在独立分支接通多批次构建、托管首页共享附近查询、同访图文和精确详情。FACT-8 同时在补充真实内容；本分支没有改写其候选批次，也没有覆盖生产部署。

深度交互：当前基线九条候选的正式发布数为 **0**。下面的扩展验证使用明确标注的合成数据，只证明接口可用；不能替代“原十家之外真实北京分店 + 原视频真实截图”的内容验收。该验收仍需可复查分店证据、图片文件及使用依据。

## 实际入口

| 项目 | 入口 / 行为 |
| --- | --- |
| 批次与作者配置 | `content/config.json`：`batches[].path/enabled`、`creator_uids[]`、`store_aliases` |
| 内容输入 | `content/batches/<batch-id>.json`；图片在 `content/images/`，只支持 jpg/jpeg/png/webp |
| 校验构建 | `npm run content:build`，成功后输出 `content/compiled.json`、`content/public-assets.json` |
| Node/Worker 内容快照 | `content/runtime.cjs`，两个运行时使用同一份构建产物 |
| 正式内容 | `GET /api/content`、`/content/` |
| 候选核对 | `GET /api/content?review=1`、`/content/?review=1`；不下发候选截图 |
| 指定到访 | `GET /api/content?visit_id=<编码后的全局到访键>`，未知/撤回返回 404 |
| 站内详情 | `/content/?visit_id=<编码后的全局到访键>`；精确选择分店、分 P、开始秒数 |
| 托管首页 | `beijing-food-map/prototype.js` → `GET /api/nearby`，服务端排序，客户端不再从固定十店取前三 |
| 共用查询 | `nearby.cjs`；Node HTTP 与 MCP 以及 Worker 都调用 `createNearbyService` |
| MCP | Node 的 `POST /mcp`，工具 `find_nearby_food`；Worker 未实现 MCP 协议，不宣称已上线 |

## 内容侧必填与审核条件

批次头：非空字符串 `batch_id`、`version`，以及 `created_at`、`source_list`、`inventory`、`records[]`。盘点应明确覆盖范围、停止位置与不可访问项，不能以少量候选声称完成全量盘点。

每条记录保留 `creator`、`video`、`visit`、`review` 四组，未确定业务字段可以是 null，先进入候选核对。正式发布还必须满足：

- 作者：`creator.uid` 在配置名单内，`creator.name` 非空；`video.owner_uid` 一致，`metadata_status=verified`。`creator.profile_url` 用于追溯。
- 视频：合法 BV、规范 `https://www.bilibili.com/video/<BV>/` URL、正整数 `part`、发布日期、有限的 `duration_seconds`。分 P 的时长与截图使用同一分 P。
- 到访：稳定 `visit.id`（字母、数字、下划线、连字符）、`store_id/store_name/branch_name`、`city=北京市`、行政区、地址、高德 POI ID 及规范链接、北京市范围内的 GCJ-02 坐标、`business_status=open`。
- 片段：`start_seconds >= 0`，`start_seconds < end_seconds <= duration_seconds`。`visit.evidence` 含原视频 branch 核准证据及秒数，以及同一 POI 的 amap 核准证据。
- 观点/菜品：每条 `text/source_video/seconds` 指向当前视频与到访片段。首页描述优先选第一条 opinion，其次第一条 dish；未提供时不编写描述。要通过完整图文卡验收，至少提供其中一条。
- 截图：至少一张 `path/source_video/part/timestamp_ms/alt/usage_basis/rights_status/frame_verified/sha256` 完整；时间在该到访片段内，`rights_status=approved`，`frame_verified=true`。构建检查文件存在、图片签名与 SHA-256，失败则拒绝构建。
- 审核：`review.status=approved` 且上述检查全部通过。仅改状态无法绕过校验。原视频继续托管于 B 站，本项目不存储视频或音轨。

## 配置与去重

```json
{
  "batches": [
    {"path": "batches/beijing-pilot-001.json", "enabled": true},
    {"path": "batches/beijing-next-002.json", "enabled": true}
  ],
  "creator_uids": ["3546888255048212", "3546728118618546", "544336675", "新增真实UID"],
  "store_aliases": {"已核实的高德POI": "beijing-5"}
}
```

以上是配置说明，两个占位符须替换为已核实的值。新增 UID 不需要修改 JS。新增批次文件交付后需要显式启用，不自动导入目录中所有文件。

| 对象 | 唯一键 / 冲突处理 |
| --- | --- |
| 批次 | `batch_id`；同一批次重复列入不重复导入，相同 ID 内容不同则构建失败 |
| 作者 | B 站 UID，字符串保存，避免超出数值精度 |
| 视频 | BV 号；每条到访仍保存自己的分 P/时长等完整视频信息 |
| 到访 | `BV:part:visit.id`；详情参数为 URL 编码后的该键，相同键但不同记录拒绝构建 |
| 门店 | 默认 `amap:<POI>`；同店两条视频只产生一个店点，保留两条到访 |
| 旧门店 | `store_aliases[POI]=旧store_id`；保留旧 ID、旧到访，并合并新到访，不凭同名猜测映射 |

显式引用旧 `store_id` 时必须补充映射。映射的目标必须存在，且一个旧店不能对应两个 POI；相同门店的地址/坐标冲突会停止构建，交由内容侧核对。已有 POI 的旧店可自动按同 POI 合并。

导入是从启用批次重建，没有追加写库副作用。重复导入数量和版本不变；停用批次、移除 UID 后重建会撤回相关公开到访、图片及新增门店。保留的旧基线门店与旧到访不会随新增批次撤回。发布新版本并重启 Node 后才更新运行快照。

## HTTP 与 MCP 字段

`/api/content` 返回：

- `batches: [{batch_id,version}]`；单批兼容 `batch_id`，多批为 null。
- `version` 为排序后的批次版本列表 + 配置及记录内容哈希。同版本字符串但内容修改，也会产生新版本。
- `published_count` 为全部公开到访数，`records` 则按审核/详情筛选。
- 每条有 `visit_id/batch_ids/detail_url/creator/video/visit/review/publication_reasons/player_url/published`。

旧 `/content/?bvid=…` 继续可用；同一 BV 有多条到访时要求选分店，不静默打开第一家。携带未知 `visit_id` 时不降级打开 BV，避免撤回记录仍被当作有效详情。

`/api/nearby` 和 MCP 工具输入一致：`location` 必填，`city`（北京/上海）与 `origin_id` 可选。多起点返回 `ambiguous` 和 `candidates`；用户选定后携带 `origin_id` 再查。输出包括：

- `status/origin/data_version/dataset/mode/coordinate_system/distance_type/results`；`GCJ-02`、`straight_line`。
- `results[].id/name/address/lng/lat/meters/visits`，同一服务排序，最多三家。`data_version` 包含基础门店目录版本和内容快照版本。
- 有已核准截图的店带 `featured_visit_id/detail_url/image/card`。`card` 包含 `store_id/visit_id/creator/description/video/image/player_url/detail_url`，全部来自同一条到访。
- `image.kind=video_screenshot` 带时间点、分 P 与来源；原有封面仍为 `video_cover`，不冒充视频截图。旧封面由 Node 保留，Worker 对旧店可只返回文字；新增核准图文在两端一致。

托管 Worker 默认 `dataset=verified`；有高德服务凭据时 `mode=live`，缺凭据仅使用明确标注的固定起点。Node 为兼容原验收仍默认 fixture。要与托管数据一致，启动时设置：

```sh
npm run content:build
DATASET=verified LOCATION_MODE=live npm start
```

实时查询另需现有高德环境凭据。固定起点离线联调使用 `DATASET=verified LOCATION_MODE=fixture`。不能比较不同 mode/dataset/version 的结果后声称链路不一致。

## 可复现接入样本与验证

`tests/fixtures/content.cjs` 提供两个合成批次（3 次到访、2 个门店、2 个 UID），其中一家有两条不同视频，另一个分店使用同 BV 的 P2 与 50 秒起点。像素图片和所有身份均明确标注为测试，不写入生产批次或 UID 配置。导出的样本在 `evidence/content-interface/synthetic-sample.json`。

```sh
npm ci
npm test
npm run test:page
FOODMAP_TEST_PORT=18910 npx playwright test --config beijing-food-map/playwright.config.cjs
npm run test:content:page
npm run test:content:integration
npm run build:hosted
```

集成测试在临时目录真实写入批次和图片，执行构建，再检验重导、调序、增 UID、撤批、文件损坏、记录冲突及旧 ID 映射。协议测试真实启动 Node MCP 服务、使用 SDK 调用工具，与 Worker HTTP、Node HTTP 逐项比较版本、起点、ID、米数、到访和图文；并核对返回的图片字节。浏览器测试使用本地 ARM Chromium，真实调用共享接口；地图 SDK 和 B 站播放器使用明确标注的替身。

桌面/手机截图是合成接口验收，不能作为真实餐厅、真实高德底图或 B 站真实播放证据。历史 Chrome 通道受 Rosetta 影响启动/页面超时；切换已安装 ARM Chromium 后完成验证。

## 发布条件与尚缺项

本轮不发布生产站点。先由 FACT-8 完成真实分店与原视频素材审核，再把这份契约和批次合并，执行构建、自动测试及预览验收；最后按现有 Sites 发布流程部署。发布前至少验收：原十家之外的一家北京分店，从附近真实地铁站搜索，首页显示真实原视频截图、直线距离、UP 主与可核查描述，点进详情定位正确分店和分 P/时间；同时检查手机及重复导入。

当前真实内容样本、公开图片依据及线上新店截图仍未交付；不能把本轮 3 条合成记录计入正式内容。未新增公网 MCP，当前 Node 协议通过不等于 Codex 客户端或线上 Worker MCP 已验收。
