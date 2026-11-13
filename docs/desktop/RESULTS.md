# FACT-11 交付与验证

已发布 v7：https://shareworld-foodmap.yzxpg95.chatgpt.site/

发布时间：2026-11-13。发布源码 74255666d4d0f8573762d49faa3c57cf935cf7ac；release bec27fabac8623ad。使用原 Site、原高德服务与公开内容接口，受众仍为 public。

首页采用 Perch Explore 的大图、留白和紧凑信息层级：左地图、右双列图文卡；搜索、博主筛选、当前起点与筛选状态清晰可见。图片比例统一且 object-fit: contain 保留原水印。店名按钮选中地图点，图钉选中并滚到对应卡片，图片进入站内精确到访详情。

/api/nearby 新增可选 limit、offset、creator，首页首批 6 家，下一批 5 家。先筛作者到访再分页，截图/作者/描述/播放器共用同一 visit_id。未传分页参数的旧 Web/MCP 调用仍返回最近三家。快速切换起点取消旧请求；数据版本改变时重载，避免追加不同版本的排序。

本轮公开数据：11 家门店、4 位博主、11 张核准原视频截图。不添加餐厅、视频、观点或 AI 图片；缺少观点时显示原视频标题，加载失败时保留店名距离并显示“截图待补”。原数据作者名保持原样。

## 验收结果

| 命令 | 结果 |
| --- | --- |
| npm test | 90 / 90 通过（47 + 22 + 21） |
| npm run test:desktop | 3 项接口 + 4 项 U1–U4 浏览器测试通过 |
| npm run test:home | 3 项已有图文卡（含手机回归）+ 4 项桌面测试通过 |
| npm run test:page | 12 / 12 双城与异常场景通过 |
| npm run test:content:integration | 2 / 2 同次到访/分 P/多分店详情通过 |
| beijing-food-map 中 npx playwright test --config playwright.config.cjs | 9 / 9 北京地图基线回归通过 |
| npm run build:hosted | 成功 |
| FOODMAP_DEPLOYMENT_URL=线上地址 npx playwright test --config playwright.hosted.config.cjs（beijing-food-map 目录） | 3 / 3 真实高德地图（王府井、东坝、大钟寺）通过 |
| node scripts/verify-desktop-hosted.cjs | 1280 / 1440 真实高德地图、分页/筛选/东坝切换、原视频播放全部通过 |

90 项基础检查 + 3 项新增接口检查；固定数据浏览器去重共 30 项，另有 3 项真实高德回归。完整日志与先红后绿证据在 evidence/desktop。mock SDK 仅用于固定数据测试；live 目录截图来自真实线上页面。

线上王府井地铁站：高德 POI BV10006496，GCJ-02 116.411571,39.908069。前三富春居 1.72 km、泰丰楼 1.92 km、北京宜宾招待所 2.82 km。查看更多追加到 11 家，无重复；厨者王波筛选为 2 家，清除恢复，东坝首家为寂川。

站内播放器 BV1AdqYYNEDM 实际播放验证：readyState=4，paused=false，currentTime 从 0 推进至 0.717201 秒。使用 Playwright Chromium 与当前网络代理验证；播放器后续可用性由 B 站控制。

交付截图：live/wangfujing-1280.png、live/wangfujing-1440.png；录屏：live/search-filter.mp4；原页面截图与行为记录：before/。源码与证据通过任务附件交付，工作目录不是下载入口。

GitHub 管理 API / 本机 keyring 均返回凭据失效，无法自动创建 PR。代码已推送分支 agent/macnimicodex/b85d530088ae。站点发布不依赖 GitHub 管理 API。
