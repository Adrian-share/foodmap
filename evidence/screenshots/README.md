# FACT-9 补图验收

直接执行：已补齐北京首页原十家门店的原视频截图。加上此前已验收的蓉亭食贝，当前 11 家正式门店均有截图，已发布至原网址 v6： https://shareworld-foodmap.yzxpg95.chatgpt.site 。

部署源码 `e649fe56c01080f7d81fd91eb7eedd8eb19bf476`，release `c8b9ec479f5878d7`，内容版本 `beijing-pilot-001:beijing-pilot-001.2026-11-11.2@f893d0c3b5aa11b6`。部署后归档证据的提交不改变线上内容。

- 对 11 次已收录到访采集 33 张候选帧；逐张查看原尺寸图片，选入原十家的 10 张，保留原有蓉亭食贝 P1/30 秒截图。
- `all-11-screenshots.png` / `overview.html`：全部正式截图总览。
- `review.json` / `capture-manifest.json`：10 张新增画面的视觉审核与采集元数据，包含原视频、分 P、实际时间、视频尺寸、时长、SHA-256。
- `unit-tests.log`：90 项自动检查通过；覆盖错视频、错分 P、越界时间、坏哈希、未解码画面和门店归属变更拒绝。
- 三份 `screenshots-*.log`：8 项桌面/手机页面检查通过；覆盖全 11 张图片加载、精确详情和缺图/坏图降级。
- 审核画廊已实测显示 11 次到访、33 张图片，并成功导出所选帧的审核 JSON。重复 `apply` 与构建后的登记文件和内容版本保持一致。
- `hosted/verification.json`：线上逐店读取图片并校验 SHA-256，与精确详情逐项比对来源、分 P、时间；11/11 通过。桌面和手机端全图解码成功，王府井查询均显示三张实图，真实地图就绪。
- `hosted/desktop-home.png`、`mobile-home.png`、`desktop-all-shops.png`、`mobile-all-shops.png`：本轮实际线上截图。
- `deployment-checks.json`：13 项公网 HTTP 检查通过。

可复用方法见 `docs/SCREENSHOTS.md`，入口 `npm run screenshots -- plan|capture|gallery|apply`。未核准分店的候选记录不因此进入正式目录。

深度交互：取帧可以自动化，选帧仍保留视觉审核。默认时间抽样不能证明画面适合展示，也不能代替门店到访关系核验。
