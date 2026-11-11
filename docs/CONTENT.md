## 北京内容批次

FACT-9 的多批次配置、接口字段、去重与扩展流程见 [内容接口契约](CONTENT-INTERFACE.md)。以下保留首批采集与来源说明。

`content/batches/beijing-pilot-001.json` 对应附件输出模板；保留 creator、video、visit、review 四组字段。未知信息使用 null。UID 与 BV 已由官方元数据核对；高德同名点位放在 `branch_candidates`，不当作实际到访分店。

`reference_images` 是官方首帧线索；`review_frames` 是浏览器在官方播放器指定时间对 video 元素截取的 PNG。它们均未取得可确认的公开使用依据，不是可发布的 `visit.screenshots`。这些图片只通过任务附件交付；Git 忽略实际图片文件，服务器路由和部署包不提供这些资源。原水印、署名和播放器画面均保留。九条视频均未下载、代理或保存。

公开列表 `/content/` 只读取通过全部门槛的记录；`/content/?review=1` 是明确标注的候选核对清单，图片区域为界面验证占位。原地图的探店入口进入本站内容页，详情按需打开 B 站官方 iframe，传 BV、分 P、起始秒数与 `autoplay=0`。iframe 禁止顶层导航与弹窗。浏览器无法可靠地跨源判断 B 站内部播放错误，提供明确的“播放器无法播放”降级按钮；iframe 文档加载成功不作为真实播放成功证据。

## 核准、构建与撤回

1. 取得原视频到访分店的可复查画面和时间点，对应高德唯一 POI、北京市地址、GCJ-02 坐标及当前营业状态；不从同名检索结果直接选第一家。
2. 取得图片使用依据，把核准图片放入 `content/images/`。按模板补充 source_video、part、timestamp_ms、alt、usage_basis、rights_status=approved、frame_verified=true 及 SHA-256。截图时间点必须属于该分店片段。
3. 在 `visit.evidence` 中分别写入已核准的 branch、amap 证据。审核通过才设 `review.status=approved`。
4. 运行 `npm run content:build`。它检查文件、图片签名和哈希，产生 `content/public-assets.json`；只有已核准图片进入运行时。缺文件或哈希不符会使构建失败。再执行 `npm test`、`npm run test:content:page` 和 `npm run build:hosted`。
5. 同一个 Worker/Node 内容路由提供正式卡片和图片。FACT-7 根目录的 `nearby.cjs` 将已核准记录加入 verified 数据集，网页与 MCP 共用；fixture 固定样本继续用于原有排序验收。FACT-9 开发分支的托管首页已接入 `/api/nearby`，与 Node/MCP 共享查询；生产部署仍以 FACT-8 的实际发布为准。当前正式内容为 0，新增真实门店尚未完成验收。

批次派生目录按 UID、BV、探店 ID 及高德 POI 去重，重复导入不叠加。`buildCatalog` 从启用批次重建，停用批次或移除加载列表再构建可撤回；线上版本可按 `docs/deployment.md` 回退。记录版本在 API 的 version 与附近搜索 verified 数据版本中。启用批次、作者 UID 与旧门店 POI 映射统一配置在 `content/config.json`；构建产生 `compiled.json` 和 `public-assets.json`，运行时不直接扫描批次。

## 基线与测试

本分支合入 FACT-7 `7d5a64a` 的双城/MCP，以及 FACT-3 `7583016` 的 Worker、部署脚本和北京页面；合并记录 `c6f1596`。生产部署没有增加公网 MCP，不把本地协议回归当作已上线 MCP。

`content.acceptance.test.cjs` 与 `content.http.test.cjs` 覆盖作者归属、分店/城市、截图/使用依据、片段时间、幂等、撤批、公开隔离、HTTP 路由及搜索接入。`tests/content.spec.cjs` 用明确标注的播放器替身验证桌面/手机操作和降级；真实播放证据另由 `scripts/verify-content-live.cjs` 在浏览器中检查 video 时间推进，JSON 和截图仅留在审核附件中。旧页面测试只把原第三方内容链接期望改为本站入口，排名、图钉、地址和距离断言保留。

`scripts/capture-content-frames.cjs` 只保存图片；`scripts/inventory-creators.cjs` 从正常官方主页记录可见范围，不绕过登录、人机校验或列表限制。原始元数据、无可用字幕结果、高德候选与列表限制在 `content/sources/`。标题与首屏数量均不代表完整北京历史。
