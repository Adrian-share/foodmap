# FACT-31 · 组件与事实证据表

核对时间：2026-11-16。源码与 Mini 专用运行 clone 均为 `21e0aafe1e50849ab4ca70cee083a1dee4138777`。文件 SHA256 见 `source-evidence.json`。本轮只生成架构/协议/验证材料，未修改生产配置、候选状态、调度或站点代码。

状态用语：**已核对源码**不等于**本轮在线实测**；**已有运行记录**不等于当前有常驻进程；**目标**代表阶段 2/3 尚未实现。

| 组件 | 入口文件 / 证据 | 数据契约 | 执行位置 | 状态 |
| --- | --- | --- | --- | --- |
| Sites 正式站点 | `.openai/hosting.json`；Sites get_site | project `appgprj_6af1f6bc10bc8191aec4fc7519a2d793`，v10，public | Sites / Cloudflare | 本轮平台确认 active、v10，automations=[]；正式域普通 HTTP 返回403，未声称浏览器复验通过 |
| Worker 路由 | `deployment/worker.mjs:22` | /healthz、content-ingest、amap-handler | Sites Worker | 已部署；旧证据 release `0c9ad3aeb4430424`；本轮源码核对 |
| 公开编译快照 | `content/runtime.cjs:1`、`scripts/build-content.cjs:31` | compiled.json + public-assets.json（base64 图片） | 构建机 → Worker 包 | 静态 require；公开内容更新需构建；不会读取私有 R2 候选 |
| 统一目录合并 | `content/home.cjs:5`、`nearby.cjs`、`content/state.cjs:4` | baseline + batch catalog；POI/visit 去重 | Worker / 本地 Node | 本轮重算 15 家唯一北京店；批次 catalog 单算仅5家，baseline为10家 |
| 门店与截图规则 | `content/catalog.cjs:6`、`:22` | creator/video/visit/review；BV/P/片段/GCJ-02/sha256 | 构建、运行时 | assess 接受 approved / verified 标签；原规则允许缺图仍可搜索，不是新的独立自动核验器 |
| 公开页面与数据 | `content/http.cjs:4`、`content/home-cards.js`、`beijing-food-map/prototype.js` | /api/home/catalog、/api/nearby、/api/creators、/api/content、/content/images/* | 用户浏览器 ↔ Worker | 读取冻结 state；首页主要使用 nearby，home/catalog 为兼容入口 |
| 地图定位 / 代理 | `beijing-food-map/amap-handler.cjs:17` | /api/amap/config、/api/amap/search、/_AMapService/* | 浏览器高德 SDK + Worker → 高德 | 已有实现；JS key 可供 SDK 使用，Web 服务与安全码在 Worker 私有配置；本页无凭据 |
| 原视频播放 | `content/catalog.cjs:28`、`content/app.js` | player.bilibili.com iframe，BV/P/t；本站详情页 | 浏览器 → B站 | 原片由 B站托管；未把视频传入 R2 |
| 原帧工具 | `scripts/screenshots.cjs:32`、`:37`、`:89` | BV/P、timestamp_ms、capture_method、sha256、审核选帧 | 已有截图执行环境 / Node | 有工具和15张编译图；现脚本自行 launch Chromium，目标须改为授权会话/流式适配，本轮未运行 |
| 旧生产调度 | `deployment/foodmap-sync/README.md`；autopilot get | 每天09:00 Asia/Shanghai；create_issue | Multica 云端 → Mini daemon | active；唯一正式 trigger 启用；下次 2026-11-17T01:00Z；Sites 无第二 schedule |
| 固定执行器 | `scripts/multica-foodmap-runtime.cjs` | JSONL probe/models/execute/cancel；一轮结束退出 | Mac mini | 已登记固定运行器，无模型/MCP/开发 shell；并非常驻内容 Pi |
| 增量采集 | `scripts/refresh-creator-inventory-incremental.cjs:214`、`:308` | seed+ledger、发现快照、来源失败退避、报告 | Mac mini | 无 GitHub watchlist 入口；合集有固定 owner/anchor；目标须通用化，不全重写 |
| 官方来源限制 | 生产 `runs/...d75010c8.../report.json` | sources_ok=1、deferred=18、new_candidates=[]、partial | Mini → B站官方 API | 本轮只读最近已有报告；历史账户 HTTP412、-352/-403；不是本轮逐账号重新联网测试 |
| 本地持久状态 | `scripts/refresh-and-upload.cjs`、`foodmap-agent-state` | incremental-state、run snapshot/report/receipt、锁 | Mac mini 专用目录 | 最近回执 revision=10、92 BV、18账号；没有 Python SQLite 服务交付 |
| 固定 SSH 中继 | `deployment/foodmap-sync/upload.py:13` | 外层仅 url/method/token/body；固定 URL；GET/POST；2MiB | Mini SSH → 上传服务器 → Worker | 源码与既有 revision=10 回执核对；本轮不改权限，不运行新上传 |
| 旧上传客户端 | `scripts/upload-creator-inventory.cjs:16`、`:74` | snapshot/run；HTTP200；revision/discovered_count/last_run；POST后GET对账 | Mac mini | 不支持新 operation 回执；必须加新客户端适配 |
| 私有 R2 候选 | `content/ingestion.cjs:3`、`:169` | private/content-incremental-v1.json；ETag CAS；已知 UID | Worker → CONTENT_UPDATES | privateState 只重建 ledger；现固定 known 拒绝未注册新账号 |
| 登录后台 | `deployment/worker.mjs:33`、`content/http.cjs:7` | /api/admin/creators、/api/admin/videos；身份头；private/no-store | ChatGPT登录 → Worker | 仅后台指定路径注入 R2 privateState；目标要增加 Python/Pi 状态而不泄露私有字段 |
| 真正 MCP 配置与处理 | `config/workbuddy/mcp.json:5`、`mcp-server.cjs:46`、`amap-server.cjs:27` | Streamable HTTP POST http://127.0.0.1:8767/mcp；find_nearby_food | 配置所在客户端机器的本地 Node | 源码使用静态 runtime；本轮 Mini 8767 refused；其他机器未核实。Sites get_site(include_mcp_connection=true)明确返回未声明MCP |
| Python 常驻队列 | 目标 `foodmap_agent/{service,queue,scheduler,watchlist}.py` | SQLite 任务/租约/游标、GitHub revision、heartbeat | Mac mini / launchd | 待实现；不是现有 Node 执行器重命名 |
| 真正 Pi RPC | 目标 `foodmap_agent/pi_rpc.py`、`agent/pi/content-tools.ts` | 1.5.2 JSONL、session、agent_settled、五工具白名单 | Python 子进程 / Mac mini | `command -v pi` 未找到；Node v22.16.0 不满足>=22.19.0；项目 Pi 配置目录未发现，真实模型未验收 |
| 独立核验与发布 | 目标 `pipeline.py`、`publisher.py`、`content/publication.cjs` | schemas.json 的 verification/manifest/operation/pointer | Mini + Worker/R2 | 待实现；上传中继承载层可兼容，业务处理尚不兼容 |
| 版本化公开读取 | 目标 Worker、共享读取层、本地 MCP 适配 | /api/content/current、/api/content/snapshot；data_version/cursor | Worker/R2 ↔ 浏览器/本地 MCP | 待实现；必须保证一次请求/翻页版本一致，不能只更新网站 |

## 本轮可重复核对的数量

从 `content/compiled.json`、`content/runtime.cjs` 与 `homeCatalog()` 只读计算：18 账号、92 BV、77 pending、15 唯一北京店、15 张公开编译图片、27 条内部记录。内部记录数量含未公开记录和 baseline，不能把它当成公开视频数量；批次5家也不能当成全站店数。

现有官方合集证据：王波 UID `3546728118618546`、合集 `5780378`，截至旧证据时间 2026-11-15T14:42Z 为61/61。本轮只保留此历史范围，不把它升级为当前全账号历史完整。

## Pi 参数证据和缺口

本轮从 [npm 官方 1.5.2 元信息](https://registry.npmjs.org/@earendil-works/pi-coding-agent/1.5.2) 下载 tarball 并验证 SHA512；随包 `docs/cli.md:119-140` 与 `dist/main.js:472-482` 明确区分 `--no-tools` / `--no-builtin-tools`，支持显式 --extension / --tools / --exclude-tools。`dist/core/extensions/types.d.ts:1327` 有 getActiveTools/getAllTools/setActiveTools；官方 get_state 不含工具清单。

冻结清理启动采用 `--no-builtin-tools + --tools 五工具白名单`，同时关闭外部扩展发现、MCP、skills、prompt templates、context files，见 protocol.md。官方 RPC 接受/结算、清队列取消与会话切换已从随包源码核对。真实启动、provider合法认证、五工具枚举和越界拒绝仍是阶段2验收，不冒称本阶段完成。

## 主根与交付位置

本任务 managed checkout 的 `git rev-parse --git-common-dir` 指向共享 bare cache：它没有可用主工作树，不能把当前 worktree 或 cache 的父目录冒充主仓库。已对既有独立运行 clone 再执行相同命令，解析到其 `.git`，主根为 `/Users/adrian/foodmap-agent-runtime/foodmap`。HTML 和 PNG 复制到该主根的 `diagrams/`，源码副本保留在提交中；这是文档拷贝，未触碰运行配置或生产进度。解析结果与哈希记录在 `root-resolution.json`。

读者下载附件；本机路径仅供 Mini 协调者回查，不是远程可打开的链接。DSH 旧失败评论完整保留，本轮没有恢复或寻找被过滤凭据。
