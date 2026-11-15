# 北京内容台账与公开博主合集

首页“博主”进入 `/creators/`，按账号查看已公开北京视频；`/creators/?uid=3546728118618546` 是厨者王波合集。视频按 B 站发稿时间倒序排列，未知日期置后并标明待补。每次到访分别保留播放、精确详情和地图定位入口，地图按稳定分店 ID 选中，支持同一视频多分店、同店多位博主。

后台 `/admin/creators/` 和账号明细 `?uid=...` 是只读页面。Sites 的 `/signin-with-chatgpt?returnTo=...` 负责登录，Worker 只信任平台注入的身份。`/api/admin/creators`、`/api/admin/videos`、旧 `/api/content?review=1` 与旧审核页都要求登录。私有响应 `private, no-store`，并按身份 `Vary`，不把整个站点改成私有。公开接口 `/api/creators` 和 `/api/creators/:uid` 只含已公开的北京到访。

Node 开发服务器直接对外提供 HTTP 时会丢弃浏览器提交的身份头，防止伪造登录；它本身不实现另一套 OAuth。受保护页面的真实登录在 Sites 验收。`tests/fixtures/creator-server.cjs` 仅在回环地址注入测试身份，用于界面验收，不能作为正式服务器运行。

## 数据来源和计数

冻结的原始附件为 `content/inventory/video-inventory-2026-11-12.json`：17 个 UID、90 个 BV。账号与样例 CSV 来自 `5d996faa`，首批 67 条与王波 61 条合集来自已验收分支。`content/inventory/access-2026-11-15.json` 记录本次逐账号访问范围、停止页、限制、官方合集61/61条和复核元数据；原始响应在 `content/sources/admin/`，不提供静态访问。

`content/ledger.cjs` 在构建时合并来源及当前批次，写入同一份 `content/compiled.json`。历史快照的“已公开”不充当当前发布许可。每个视频的来源、处理状态、缺项和到访均可追溯；相近昵称、不同 UID 不合并。已知账号关系保留原证据和未确认说明。

- 发现：按 BV 去重的全部线索。
- 公开：当前至少有一次已核准北京到访的视频。
- 待核：未公开且未全部排除的视频，含候选样例。
- 排除：所有到访都被审核排除、且没有已公开到访的视频。
- 可搜分店：该账号已公开到访的稳定分店 ID 去重数。

前三种处理状态互斥，公开 + 待核 + 排除 = 发现。分店数不能跨账号或跨起点直接求和作为全市总数。发稿时间来自 B 站，本站收录时间独立显示；旧记录没有收录时间时待补。发现时间只表示已记录的登记或快照时间；快照日期不冒充真正的首次发现时间。

## 持续更新

1. `node scripts/refresh-creator-inventory.cjs` 读取官方公开投稿第1页、已提供样例和可访问的王波官方北京合集，记录每个入口的范围和受限原因。脚本不绕过登录或验证，不把未返回的列表当成零视频，也不宣称全账号历史完整。成功返回的新线索保持待核。
2. 新账号以 UID、主页和至少一个北京原视频加入候选 CSV，或加入新批次的待核记录；不要修改原附件来掩盖历史。扩展来源范围时保留原始响应和实际停止位置，账号 UID 关系必须有证据。
3. 继续沿用 `content/batches/*.json`、`content/config.json` 的批次入口。补齐元数据、实际分店、地址、GCJ-02、高德 POI、同次到访截图、描述时间点和审核结论后才批准。旧门店按 `store_aliases` 对应已有稳定 ID；每条新到访保留独立 ID。
4. `npm run content:build` 验证并重建。待核条目只在登录后台可见，重复启用同一批次不增加计数；停用批次后重建即可撤回。原图采集与复核继续使用 `npm run screenshots -- ...`；候选采样计划和实际解码记录也可用 `scripts/inspect-candidate-frames.cjs` 保留。
5. `node scripts/export-creator-report.cjs` 输出逐账号覆盖、逐BV处理结果和本批新增清单。复核后运行下述检查，再按 `docs/deployment.md` 发布同一快照。

```sh
npm run content:build
npm test
npm run test:creators
npm run test:content:integration
npm run test:home
npm run test:content:page
npm run build:hosted
node scripts/export-creator-report.cjs
node evidence/admin/verify-hosted.cjs https://shareworld-foodmap.yzxpg95.chatgpt.site
```

本次 `beijing-admin-002` 核准“聚首堂（什刹海德胜门店）”与“缘赵记（珠市口店，高德现名珍贝大厦店）”，原视频简介分别给出具体分店和门牌，POI 与地址匹配。截图均来自同一个原视频的真实解码帧；没有落盘视频或音轨。

## 验证边界

真实登录由平台管理；已登录界面和接口使用回环测试身份验收。线上验证匿名跳转、匿名/伪造身份头拒绝读取审核API，最终登录后可见范围仍应由用户用自己的登录会话验收。账号完整投稿范围受 412/-352/-403 限制，剩余待核视频需要分店和截图等证据，不能当成已收录门店。当前营业状态保留 unknown。
