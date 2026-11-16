# FACT-33 集成交付与验收边界

本交付从 `4cea4d3b263edbc948632bdd9f6666ee3dd188b3` 开发，保留阶段1协议、阶段2服务及用户 canonical 名单提交 `593cfc7fde12520f1f5ba35ed92b765bb5d9d59f`。真实集成目标仍为 `fact-18/beijing-content-003`。源码、离线结果与真实来源结果分别记录；正式发布由父协调者复核后完成。

## 已实现

- 沿用五个固定 Pi 工具。官方 BV/P 元数据和字幕、原流内存取帧、北京 POI 固定入口、原帧 Native Vision OCR 均登记哈希与时间；并发工具的整个证据读写事务串行化。
- `content/verification.cjs` 读取适配器原始证据，独立检查作者、分店文字/地址与唯一 POI、GCJ-02、片段、原帧与描述出处。描述保守限定为官方字幕或绑定原帧 SHA/时间的 OCR 原文；缺证据保持待核。确定作者不符、关闭/迁移或异地证据可以排除。
- Python 在原 SQLite 队列中推进 verifying → staged → published，持久保存待发布计划和原始字节；恢复先查回执。preview 只产生私有计划，production 才公开。
- 冻结 operation 的分片、stage、commit、receipt、rollback、heartbeat 均使用原固定接口；旧候选载荷和 2MiB 限制保留。R2 CAS 指针与不可变 transition 链处理并发、回执丢失和回退；图片实际同源 GET/类型/长度/SHA 通过后才切版本。
- 多帧中只将最终 records 引用的图纳入公开清单。修订同 visit 时按最终全部 records 裁剪 images；旧版本对象和图片不删除。两项均有实现前失败和通过回归。
- Worker 的公开 current/snapshot、首页、附近、合集、详情均读取捕获的同一版本；翻页和详情带版本。私有后台沿用登录，显示心跳、Pi、队列、来源游标/失败/退避、逐 BV 缺项与发布版本。
- 本地 Node MCP 每次工具调用读取正式站 current 再固定 snapshot，不增设云 MCP。离线测试实际走 Streamable HTTP，但其内容响应是 fixture，不能计作正式 MCP 验收。
- Worker JSON Schema 已预编译，运行时不用 eval/new Function；有禁动态代码的 Worker bundle 回归。

## 真实证据

`evidence/FACT-33/real-source.json`：候选 `BV1rK4AzFEpN`，真实作者 `3546971182729637`，官方 CID `32996395515`；12.001 秒 PNG 为 360×640、411842 字节，SHA256 `854e2e7fda3b3d7e47f3f14d65734b059a392608e2d44600ce93e98a531e299e`。视频、音频和流分片未落盘。图只随任务证据附件交付，未写公开批次或生产。

`real-pi-candidate.json` 保留真实 Pi 1.5.2 五工具审计、模型名、图像调用、agent_settled 和独立待核原因。请求 `doubao-seed-2.1-turbo`，实际响应 `doubao-seed-2-1-pro`；没有把 cost=0 当免费。并发证据覆盖的首次真实失败保留在 `red-real-pi-concurrent-tools.json`。

`public-http-identity.json`：Python 默认 UA 实测403/1010；明确的项目 UA 与 Accept 使健康检查200，当前仍是 v10 release `0c9ad3aeb4430424`；新版 current/poi 路由404。403/404均报错，不解释为空目录。未修改访问模式、Cloudflare 策略或 Cookie。项目身份为 `FoodmapContentAgent/1.0 (+https://github.com/Adrian-share/foodmap)`；GitHub 保留其 raw media-type 协商。官方解释见 [Cloudflare Error 1010](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/)。

`production-readonly.json`：原固定 SSH GET 仍成功，revision=10、92 discoveries、18 accounts；其响应没有新 operation capabilities。Mini 本地配置的 :8767 当时未监听。该记录的 Python 403 原因已由上述 UA 对照纠正；不能当成网站权限问题。

## 本机验证

先用 `/usr/local/bin/python3 deployment/foodmap-agent/install.py` 安装专用 Node22.23.5 arm64、项目 venv/Pi1.5.2 和可用时的原生 OCR；不改变系统 Node。原帧适配依赖现有 `/usr/local/bin/ffmpeg`（本机7.1.1），不安装全局工具。

```sh
export PATH="$PWD/tools/node-v22.23.5-darwin-arm64/bin:$PATH"
npm test
npm run test:refresh
tools/venv/bin/python -m unittest discover -s tests/agent -v
npm run test:publication
npm run build:hosted
```

PATH 仅作用于当前测试 shell；Pi 继续使用净化环境和绝对 Node 路径。不要在安装 arm64 esbuild 后用 Rosetta 的系统 Node 执行其构建测试。

```sh
# 原始流和 OCR，真实来源，只落图片与证据，不发布
tools/node-v22.23.5-darwin-arm64/bin/node scripts/stage3-source-probe.mjs
# 真实 Pi 会消耗已授权模型额度；隔离状态，不接上传配置
tools/venv/bin/python scripts/stage3-real-pi-probe.py
# 真实生产 HTTP 只读预检
tools/venv/bin/python scripts/stage3-public-http-probe.py
# 正式验收缺项时此命令必须失败，不能用 fixture 填通过
npm run test:publication:live
```

## 仍待协调者接续

1. 核对 Git 提交、部署包 SHA 和 hosting.json，使用同一确切版本部署 Worker；保持既有公开受众和 CONTENT_UPDATES 绑定。先以带项目 UA 的 healthz.source_commit/release 证明已更新，不能在旧v10验新路由。
2. 在隔离队列走真实 GitHub 合法名单变化、watchlist.sync 回执及服务激活，核对作者后同 BV 只入队一次。保留18 UID、92旧 BV、15旧店和历史游标。
3. POI 新入口部署后复测真实候选；当前候选仍缺具体分店、POI 与可发布描述。须另补实际原片/原帧证据或选择有足够来源的合法候选。Native OCR 能证实所见原文，不足以从一碗面推出具体地址。
4. 实际经 Pi/独立核验/新 operation 正式发布至少一家原15店以外的北京分店。验证同源图、发布回执、无重部署60秒可见、右侧卡片及 B站播放时间推进。
5. 正式域王府井、东坝、大钟寺：起点、图钉/卡片、筛选/更多、2km覆盖前后和全市净增分别对账。实际 MCP 所在机器的 :8767 更新并调用正式 snapshot；本地 fixture 或 Mini 无监听不能冒充该项。
6. 持久托管、服务自身真实定时、真实名单变更及最终部署下恢复通过后，父协调者按冻结顺序暂停并排空旧 Autopilot，再启动唯一 Python 生产调度。保存旧触发状态、最后回执、源提交、公开 data_version 与回退记录。

`live-acceptance.json` 明确保留 R2/R3/R4/E1/E2/E3 的正式待验收状态；原22项总台账不得关闭。当前没有生成真实公开 data_version，不能提供虚构的正式发布或回退版本号。
