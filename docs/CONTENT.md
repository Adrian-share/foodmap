## 首页门店与图文卡（2026-11-11）

多批次、作者配置、旧门店映射与精确到访契约见 [FACT-9 内容接口说明](CONTENT-INTERFACE.md)。

本轮以 `docs/spec/home-cards/TASK.md` 和《验收规格.md》为准。分店与视频关系核对通过即可进入首页搜索；图片独立核验，缺图或图片加载失败显示“截图待补”。上一轮把截图使用依据和必须有图作为收录前置条件，与本轮明确规格不符，已移除这些额外门槛；不把任务指定的截图展示描述成取得创作者授权。

当前收录新店为蓉亭食贝（亚运村店），稳定 ID `amap:B0FFGCY5QP`。原视频 `BV1AdqYYNEDM`、作者 UID `3546728118618546`；P1 00:12 牌匾直接写明“蓉亭食贝（北京亚运村店）”。P1 00:30 为肉丝近景且字幕提到肉丝很嫩，首页图片和短描述绑定该次探店。高德地址、行政区、GCJ-02 与牌匾分店对应；当前营业状态未实时保证，保留 unknown，页脚提示出发前核实。

数据保存在 `content/batches/beijing-pilot-001.json`。`content/catalog.cjs` 负责作者、视频、分店、片段和审核校验；`validScreenshot` 单独校验截图来源、分 P、时间点、路径与哈希。`scripts/build-content.cjs` 校验实际图片并生成部署用 `content/public-assets.json`。图片在 `content/images/`，视频响应、片段和音轨不保存。

`content/config.json` 配置启用批次、作者 UID 和旧门店映射，构建生成同一内容快照。`nearby.cjs` 把原十店与已核准批次合并，按分店 ID/POI 去重并保留多个探店关系。旧线上 samples.js 没有暴露稳定 ID，沿用已验收 `data/catalog.json` 的同名 beijing-1…10，未重写旧店地址和点位。`/api/home/catalog` 保留为兼容目录入口；`beijing-food-map/prototype.js` 直接调用 `/api/nearby`，与 Node/MCP 使用相同的服务端排序。没有为安立路或新店写单独结果，所有正常地点查询走原高德检索。

`content/home-cards.js` 和 CSS 在托管北京版及根目录双城版共用。卡片编号来自排序后的同一数组，与地图 Marker 使用同一门店 ID、编号和点位。卡片只有一个站内详情入口；真实截图使用 contain 保留完整水印。详情按需打开 B 站官方播放器，默认不自动播放。固定样本保留用于回归；生产结果按本次目录重新排序。

## 盘点、验证与维护

三位作者的逐条盘点在 `content/inventory/creators-2026-11-11.json`。种子九条仍是内容核对批次；王波官方北京合集增加 58 条待核线索，共盘点 67 条，逐条核对作者 UID。其余未核分店不进入首页。官方合集与账号投稿接口限制均留证；合集末尾不等于账号历史末尾。

运行 `npm run content:build`、`npm test`、`npm run test:home`、`npm run test:page`；托管北京旧页面回归在 `beijing-food-map/` 中运行 `../node_modules/.bin/playwright test`。本地托管首页用 `npm run start:home`，默认 8766 端口；根目录 `npm start` 仍为双城/MCP 应用。

本轮证据在 `evidence/home-cards/`：01-red.tap 与接入前线上 before-home.json/png 证明原先无新店。`scripts/verify-home-cards-hosted.cjs` 从线上正常搜索，检查图片加载、独立复算距离、核对图钉 ID 和编号，再检查详情和图片失败降级。旧 test-results 和 evidence/content 是上一轮历史证据，不替代本轮结果。

重复导入同批次不增加点位。buildCatalog 按启用批次重建，可停用/撤回批次后重新构建；整站回退沿用 docs/deployment.md。本轮更新原有公开站点，保留受众，不增加公网 MCP。
