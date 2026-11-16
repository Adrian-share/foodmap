# FACT-32 · Python / Pi 基础服务

本阶段交付源码与隔离验收，生产仍由旧 Autopilot 调度。没有加载新的 launchd、部署 Worker、修改 DSH/Codex 或切换生产状态。阶段3负责内容独立验证、取帧/POI适配器、公开发布和最终切换。

## 安装和运行

在协调者选定的专用项目副本执行 `/usr/local/bin/python3 deployment/foodmap-agent/install.py`（本机实测3.13.3，要求≥3.12；在下载、解压或venv创建前拒绝SSH默认3.9）。安装器校验 `agent/pi/runtime.lock.json` 中官方 Node 22.23.5 darwin-arm64 SHA256，用项目 Python venv、精确 Python requirements 和 npm lockfile 安装，不运行 npm 安装脚本，不改系统 Node/PATH。Pi 为 `@earendil-works/pi-coding-agent@1.5.2`。冻结架构包里的 Node 22.19.0 是历史最低版本证据；本阶段实际使用22.23.5。

以下命令在项目根运行；测试状态始终使用隔离目录：

```sh
./tools/venv/bin/python -m foodmap_agent --state "$PWD/.agent-state/preview" serve --offline
./tools/venv/bin/python -m foodmap_agent --state "$PWD/.agent-state/preview" status --json
./tools/venv/bin/python -m foodmap_agent --state "$PWD/.agent-state/preview" run-once --json
./tools/venv/bin/python -m foodmap_agent --state "$PWD/.agent-state/preview" sync-watchlist --json
./tools/venv/bin/python -m foodmap_agent --state "$PWD/.agent-state/preview" export-report --json
```

`serve --offline` 只运行真实 Pi 控制面与心跳，不做来源采集或模型任务。正常 `serve` 轮询 GitHub、调度来源、处理业务任务；手动命令只写请求标记，由同一个服务消费，不能另起调度器。`export-report` 为私有运维输出，含业务与会话定位信息，不提供匿名接口。

接入用户明确交接的私有配置：

```sh
./tools/venv/bin/python -m foodmap_agent --state "$PWD/.agent-state/model-preview" \
  --model-config /Users/adrian/foodmap-agent-state/pi/model-private.json \
  --upload-config /Users/adrian/.config/foodmap/ingest.env serve
```

此命令会向真实服务申请名单注册，只在协调者部署兼容 Worker、合入名单后执行。模型私有 JSON 模式必须0600，字段为 `provider/model/api/base_url/api_key/models_config`；最后一项是交接的单 provider 无凭据 models.json 路径。读取后按 Pi 1.5.2 官方 models schema 验证，再写入隔离 `pi/config/models.json`。只把 key 注入 Pi 的 `FOODMAP_MODEL_API_KEY`，不继承上传令牌、Multica、SSH、代理或其他 provider 凭据。未交接模型时显示 `blocked_model`；不读取 DSH/Codex 配置或其他进程凭据。

实际接入 `ark-coding-plan-cn` / `anthropic-messages`，请求模型 `doubao-seed-2.1-turbo`。Pi 官方 `provider_stream_event` 记录响应模型，不能用请求别名推测实际路由。`cost=0` 只是用户交接的模型元数据，不证明免费；金额未核实。默认每天最多10个业务尝试、输出8192 tokens、单任务180秒、最多3次尝试、清理并发1。来源每轮最多60个有界请求，单来源独立退避。脚本诊断会真实调用模型，应串行按需执行。

## 持久性和边界

SQLite 保存视频实体、独立任务、来源游标、租约、证据索引和操作回执；Pi会话单独在 `pi/sessions`。业务键为 `(bvid,part,rules_version)`，BV跨来源合并证据，不能用Pi会话代替业务台账。先对账未确认操作，再回收过期租约。正在使用的 lease 默认300秒，重启不能抢活跃租约。

名单固定读取 `Adrian-share/foodmap` / `fact-18/beijing-content-003` / `content/watchlists/beijing.json`，先解析commit再按commit读取正文；保存原始字节哈希与ETag。注册操作持久预备后发送，收到服务端 `committed` 才激活；403/429/超时/损坏名单保留最后有效版本。首次注册若 Worker 尚无新协议会阻止激活，不假装成功。新UID同时进入服务端 ingestion 和 catalog 的有效registry；禁用/移除保留接受过的历史身份。

投稿、任意合集及指定BV各有游标。满页和旧/置顶BV都不能停止下一页。合集列表缺作者字段时，先建立受当前有效来源约束的官方view核对任务；只有view作者核对后才入业务队列。删除一个合集不删除其历史游标，但立即失去调度资格；该合集派生的待核view也停止，仍被其他有效来源引用的view可继续。

Pi实际启动使用绝对Node路径、`--no-builtin-tools`、显式扩展、五工具白名单和所有自动发现禁用参数。每次session切换/恢复重新审计active/all工具。只有 `content_read_evidence/content_fetch_metadata/content_capture_frame/content_search_poi/content_submit_extraction`。后两种来源适配器在阶段3接入，目前明确返回blocked_capture/pending，不伪造图或POI。

受限工具拒绝错task/BV/UID、额外字段、任意路径与symlink；只接受登记artifact ID并复算文件哈希。内容和名单永不成为shell、RPC type或slash命令。最终 `agent_settled(aborted=false)` 之后才校验结构化提案和身份，进入 `verifying` 仍不代表内容获准发布。

## 验证

```sh
./tools/venv/bin/python -m unittest discover -s tests/agent -v
node --test tests/watchlist-registry.test.cjs tests/source-page.test.cjs tests/pi-content-tools.test.cjs
npm run test:refresh
npm run test:agent
npm test
```

真实模型/图片/工具/十分钟空闲：`./tools/venv/bin/python scripts/agent-real-pi-probe.py`；读取已有核准记录与真实旧截图，只提出uncertain提案，不发布。真实崩溃恢复：`./tools/venv/bin/python scripts/agent-recovery-probe.py`，仅允许全新的 `.agent-state/recovery-probe`，杀死自建Pi组与Python后恢复同一job/session。十分钟观测是前台运行，应收集完成结果，不能background-and-yield。

红绿日志与真实证据在 `evidence/FACT-32/`；其中 fixture/offline、无模型控制面、实际模型验收分开标注。GitHub固定分支若尚无名单，404证据不能算W1/W2真实通过；开发分支读取也不能冒充已集成。

## 停止、恢复和协调者安装

前台运行用Ctrl-C或向status中的本服务PID发SIGTERM。服务清空Pi队列、abort、确认空闲；超时只终止自己创建的进程组并回收当前job，正常退出释放单例文件锁。空闲Pi退出后每轮健康检查重启并重新审计工具，通常10秒内恢复；启动失败按30秒起指数退避，最大300秒，心跳暴露退避状态，不触发模型请求。不会按进程名杀daemon。崩溃后的短期未过期租约须到期后恢复，不清空SQLite、cursor或Pi会话。

`render-launchd.py <隔离状态目录>` 输出可审阅的preview plist，默认 `--offline`，不自动安装。协调者可将同一commit装入专用运行目录后，渲染plist到该目录、创建日志目录，审阅后用 `launchctl bootstrap gui/$(id -u) <plist>` 托管；停止用 `launchctl bootout gui/$(id -u) <plist>`，恢复用bootstrap或kickstart该明确label。安装路径由渲染器固定为其实际项目副本，不修改daemon环境。

生产切换仍遵循阶段1：阶段3真实发布验收通过 → 暂停旧Autopilot并等待在途结束 → 迁移最后成功状态与回执 → 启用唯一Python生产调度。回退先bootout Python并确认子进程、锁和在途回执，再恢复旧Autopilot，不能反向执行。
