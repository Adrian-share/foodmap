# FACT-13 交付与验收

直接执行：登录后台与公开博主合集已发布 Sites v9，沿用已验收桌面 v7 的地图、筛选与批次构建入口。全部17个UID、90个BV可追溯；当前13个公开视频、13家唯一北京分店、6位公开博主；本批净增2个视频和2家分店，77条待核、0条排除。

入口：[公开博主合集](https://shareworld-foodmap.yzxpg95.chatgpt.site/creators/) · [登录后台](https://shareworld-foodmap.yzxpg95.chatgpt.site/admin/creators/) · [王波后台](https://shareworld-foodmap.yzxpg95.chatgpt.site/admin/creators/?uid=3546728118618546)。

发布状态 succeeded；release `b95d97ad77baad30`，发布源码 `f7999a9dcae315401469e1ca70367e280836431e`。精确版本、deployment ID及数据摘要见 `evidence/admin/release.json`。GitHub任务分支为 `agent/macnimicodex/e96a76905982`，以已验收 v7 分支 `agent/macnimicodex/b85d530088ae` 为基线；默认 main 只有初始化README。管理API返回401，未自动创建PR；分支已成功推送。

|本批新增|原视频 / UID|稳定门店 / 高德POI|证据|
|---|---|---|---|
|聚首堂·什刹海德胜门店|BV1ytEE6rE2s / 613814196|amap:B0FFLI74FK|原视频简介写明分店；高德西城区德胜门内大街38号40号44号，GCJ-02 116.380064,39.947007；P1 240秒真实画面与描述|
|缘赵记·珠市口店（高德现名珍贝大厦店）|BV1ZF411x7Wo / 12613385|amap:B0G1PUL2XB|原视频简介给出珠市口东大街6号6-5；高德同址珍贝大厦F1，GCJ-02 116.411348,39.892465；P1 50秒真实画面与描述|

原始元数据、高德响应、解码时间/哈希及审核结论均保留。门店营业状态维持unknown，未用历史视频承诺当前营业。视频与音轨不落盘。新增来自已有候选，未假称发现新的UID。

|验收|结果与证据|
|---|---|
|C1 盘点可对账|17个账号、90个BV逐条复算；王波61条官方北京合集本次重新返回61/61，账号投稿第1页受限。逐账号来源范围、停止位置、限制及下一步见coverage.csv/md；完整视频状态见video-outcomes.csv、ledger.json。|
|C2 后台可追溯|已登录回环界面测试验证王波61条、筛选缺项、候选样例及时间口径；线上匿名后台302跳登录、审核API401；伪造身份头被拒绝。真实用户登录后的线上会话留给本人验收。|
|C3 去重与发布|真实新批次在审核前仍只有11条公开，批准后13条；重复构建结果完全一致。原视频、UID、截图和POI已对应。多视频同分店、多分店/分P、撤批/重导由合约与集成测试验证；本批真实新增是两条各关联一间新店，未伪造第二条同店视频。|
|C4 合集与覆盖|6位博主公开合集按B站发稿日期倒序，站内播放、到访详情和地图选中对应。两条新增视频在线上均实际播放推进；三站真实高德截图与JSON已保存。|

三站均请求完整结果 `limit=50`；数字表示全市已收录门店的距离排序，不是某个半径内的覆盖率：

|起点|公开BV（原→现）|唯一分店（原→现）|净增视频 / 分店|
|---|---:|---:|---:|
|王府井|11→13|11→13|2 / 2|
|东坝|11→13|11→13|2 / 2|
|大钟寺|11→13|11→13|2 / 2|

三个结果合并后全市仍为13个BV、13家店，不能相加成39家。王府井当前前三：富春居1.72km、缘赵记1.74km、泰丰楼1.92km。完整起点POI、GCJ-02、距离和净增集合见 `evidence/admin/hosted/results.json`。

|实际命令|结果|
|---|---|
|npm run content:build|3条批次核准到访 + 10条既有到访；13张核准截图；17账号90个BV，重复构建一致|
|npm test|95/95（47+22+21+5）；22-final-all.tap|
|node --test desktop.acceptance.test.cjs|3/3；17-desktop-core.tap|
|npm run test:creators|4项浏览器测试通过；最终5项接口/台账测试另通过，20-refresh-persistence.tap|
|npm run test:content:integration|2/2；12-integration.log|
|npm run test:home|7/7；13-home.log|
|npm run test:content:page|3/3；14-content-pages.log|
|npm run test:page|12/12；15-page-regression.log|
|npm run build:hosted|成功；同一源码经Sites helper提交、推送、打包并发布|
|npm run verify:deployment -- https://shareworld-foodmap.yzxpg95.chatgpt.site|13项公网部署检查通过；19-deployment.log|
|node evidence/admin/verify-hosted.cjs|最终v9实测通过；23-final-hosted.log、hosted/results.json及三站截图|

先写的4项验收测试全部失败，见01-red.tap，随后转绿；初次旧集成测试因审核页面新增登录要求而失败，已更新回环测试身份并复测通过。历史基线截图保留，本轮截图独立放在evidence/admin/regression。浏览器固定数据测试使用地图/播放器替身；hosted目录是实际线上高德和B站播放器，网络使用本环境已配置代理，不将这次结果推广为所有网络均可达。

深度交互：本轮实现了可持续维护的台账和批次闭环，不代表77条待核视频已经完成分店核准，也不代表任一账号历史已穷尽。下一步所缺的是各视频的实际分店、POI、片段与截图等证据，以及可访问的官方投稿范围；逐账号已列清。后续刷新保留旧发现和成功范围，每次请求单独留存原始响应，避免一次接口限制抹掉历史工作。
