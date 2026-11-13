# FACT-11 桌面首页验收

基线：线上 Sites v6，对应源码 e649fe56c01080f7d81fd91eb7eedd8eb19bf476。先保存公开目录快照、1280/1440 原首页与 Perch 参考截图，再编写失败测试。公开数据快照在 tests/fixtures/desktop-catalog.json；原页面行为在 evidence/desktop/before/behavior.json。

- U1：1280 / 1440 下顶部搜索和博主同排；左高德地图、右双列原视频图文卡，无横向溢出。
- U2：王府井地铁站，按直线距离排序；店名按钮在地图选中同店，图钉滚动并选中同一 ID 卡片。
- U3：首批六家，追加后续门店且 ID 不重复；按博主先筛到访、再排序分页，保留起点；清除后恢复；搜索东坝重置结果。旧 /api/nearby 和 MCP 不传分页参数仍默认三家。
- U4：核准截图、作者、说明及 visit_id 同次到访；站内官方 B 站播放器；未知地点与图片失败状态清晰。

固定数据 / 模拟 SDK 检查：npm run test:desktop、npm run test:home。合成多到访数据验证同店不同博主时作者、截图、视频不串联，不进入部署数据。

真实线上检查：node scripts/verify-desktop-hosted.cjs；不拦截地图、搜索或播放器。保存两种宽度王府井截图、搜索筛选 WebM 录屏与真实播放进度。模拟 SDK 截图不能当作真实地图验收证据。
