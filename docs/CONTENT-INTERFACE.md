# 内容模块接口契约与 FACT-9 验证

直接执行：已合并 FACT-8 最新基线 `4d48a57`（v4 线上源码 `c027531`），保留已验收首页图文卡和真实新增分店。接口改造将启用批次、作者和旧门店映射配置化，托管首页改为共享附近查询，同一次到访的图片、作者、描述、详情和播放器保持一致。

深度交互：分店与图片分别核验，沿用最新 `docs/spec/home-cards/验收规格.md`：分店关系核准即可搜索，缺图提示“截图待补”；不把授权证明或实时营业保证额外设为入库门槛。新增 UID 与多批次测试使用标明的合成数据，未作为真实内容发布。

## 实际入口

| 项目 | 入口 / 行为 |
| --- | --- |
| 批次与作者配置 | `content/config.json`：`batches[].path/enabled`、`creator_uids[]`、`store_aliases` |
| 内容输入 | `content/batches/<batch-id>.json`；图片在 `content/images/`，只支持 jpg/jpeg/png/webp |
| 校验构建 | `npm run content:build`，成功后输出 `content/compiled.json`、`content/public-assets.json` |
| Node/Worker 内容快照 | `content/runtime.cjs`，两个运行时使用同一份构建产物 |
| 正式内容 | `GET /api/content`、`/content/` |
| 候选核对 | `GET /api/content?review=1`、`/content/?review=1`；只下发已收录且通过文件校验的截图 |
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
- 到访：稳定 `visit.id`（1–200 个字母、数字、下划线、冒号或连字符）、`store_id/store_name/branch_name`、`city=北京市`、行政区、地址、高德 POI ID 及规范链接、北京市范围内的 GCJ-02 坐标、营业状态不得明确为 closed/moved；unknown 保留，页面提示出发前核实。
- 片段：`start_seconds >= 0`，`start_seconds < end_seconds <= duration_seconds`。`visit.evidence` 含原视频 branch 核准证据及秒数，以及同一 POI 的 amap 核准证据。
- 观点/菜品：每条 `text/source_video/seconds` 指向当前视频与到访片段。首页描述优先选第一条 opinion，其次第一条 dish；未提供时不编写描述。要通过完整图文卡验收，至少提供其中一条。
- 截图独立校验：展示的图片须有 `path/source_video/part/timestamp_ms/alt/frame_verified/sha256`，时间在该到访片段内，`frame_verified=true`。`usage_basis/rights_status` 保留追溯记录，不等同于已取得创作者授权。元数据合格的截图还要通过文件存在、图片签名及 SHA-256 检查；文件损坏会拒绝构建。无图或图片元数据不符的核准门店仍可搜索，以“截图待补”显示。
- 审核：`review.status=approved` 且上述检查全部通过。仅改状态无法绕过分店与视频校验。原视频继续托管于 B 站，本项目不存储视频或音轨。

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
- 每条有 `visit_id/batch_ids/detail_url/creator/video/visit/review/publication_reasons/player_url/published/image_status`；`image_status=missing` 与分店审核状态分开。

旧 `/content/?bvid=…` 继续可用；同一 BV 有多条到访时要求选分店，不静默打开第一家。携带未知 `visit_id` 时不降级打开 BV，避免撤回记录仍被当作有效详情。

`/api/nearby` 和 MCP 工具输入一致：`location` 必填，`city`（北京/上海）与 `origin_id` 可选。多起点返回 `ambiguous` 和 `candidates`；用户选定后携带 `origin_id` 再查。输出包括：

- `status/origin/data_version/dataset/mode/coordinate_system/distance_type/results`；`GCJ-02`、`straight_line`。
- `results[].id/name/address/lng/lat/meters/visits`，同一服务排序，最多三家。`data_version` 包含基础门店目录版本和内容快照版本。
- 有已核准到访的店带 `featured_visit_id/detail_url/card`，图片可为 null。`card` 包含 `store_id/visit_id/creator/description/video/image/player_url/detail_url`，全部来自同一条到访。
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

## 真实样本与发布核对

接入成功样本：蓉亭食贝（亚运村店），`amap:B0FFGCY5QP`，作者厨者王波 UID `3546728118618546`，原视频 `BV1AdqYYNEDM`。店点 GCJ-02 `116.413218,40.006234`；从安立路地铁站 `116.407845,40.002619` 搜索，新店第 1、约 0.61 km。首页真实截图 P1 00:30，分店牌匾证据 P1 00:12，描述为“试吃肉丝，并提到肉丝吃起来很嫩”。完整记录见 `evidence/content-interface/accepted-sample.json`。

全局到访键为 `BV1AdqYYNEDM:1:BV1AdqYYNEDM:p1:B0FFGCY5QP`，链接 `/content/?visit_id=BV1AdqYYNEDM%3A1%3ABV1AdqYYNEDM%3Ap1%3AB0FFGCY5QP`。此键包裹原有稳定 ID，不修改采集记录。当前共 11 家北京门店、1 次新增核准到访、1 张公开截图；其他候选保持待核。

FACT-9 本地真实样本测试读取正式批次和图片，只替换高德上游地点响应与地图 SDK；独立保留桌面/手机卡片截图，不能把模拟底图当作真实高德证据。FACT-8 v4 的真实线上地图证据保留在 `evidence/home-cards/hosted/`。新增扩展场景另使用两批合成数据验证，不发布为内容。

通过构建、服务/MCP 协议、两套首页、内容页与多批次页面检查后，沿用同一 Sites 项目和公开受众发布。发布记录和最终测试数见 `evidence/content-interface/validation.json`。Sites 原生接口已确认当前站点未声明 MCP；本变更没有新增公网 MCP。Node 协议比较通过不代表 Codex 图形客户端已实测。
