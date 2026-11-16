# FACT-31 · Python / Pi 内容闭环协议 v1

状态：阶段 1 冻结候选，供协调者复核；这里定义的服务与新端点尚未实现、安装或上线。当前产品源码基线为 `21e0aafe1e50849ab4ca70cee083a1dee4138777`，集成目标为 `fact-18/beijing-content-003`。阶段 2、3 必须使用本协议；需要变更时先修改版本和兼容说明。

`schemas.json` 使用 JSON Schema 2020-12，`#/$defs/<名称>` 是独立契约。全部新对象拒绝额外字段；`examples.json` 仅是离线结构测试样例，不能上传生产。JSON Schema 不能证明作者、哈希、分店、图片内容或授权，以下关系检查同样是强制契约。

## 1. 唯一所有者、状态与执行边界

生产业务调度只允许一个 Python 实例：Mini 用户级 launchd 托管 Python，Python 直接持有一个真实 Pi JSONL RPC 子进程和受控 Node 内容适配器。launchd 只恢复进程，不重复触发采集；Pi 不自行定时查来源。开发/预览使用隔离状态，旧 Autopilot 此时仍是唯一生产调度。

- 代码：既有 `foodmap-agent-runtime/foodmap`。项目工具安装在同一专用运行范围的 `tools/` 和 `agent/pi/`。生产状态仍在 `foodmap-agent-state/`；测试使用工作目录内专用子目录，不读写生产 SQLite 做故障测试。
- SQLite 保存 watchlist_revision、source_cursors、jobs、leases、evidence、publications、receipts 和 service_state。Pi session 独立保存，不能替代业务台账。
- job 唯一键 `(bvid, part, rules_version)`；一个 BV 实体可有多条到访。到访键复用 `BV:P:visit.id`，门店归一到已核准 POI 与旧 store_aliases。新记录不可仅凭标题/昵称新建重复实体。
- 阶段：`discovered → cleaning → verifying → staged → published`。缺证据进入 `pending`，模型/取帧不可用分别为 `blocked_model` / `blocked_capture`；预算耗尽为 `deferred_budget`；排除保留依据。上传阶段单独记录每个 blob 和 request_id，不以 job.done 推断已发布。
- 事务领取任务并保存 lease_owner、lease_until、attempt、next_retry_at；单例锁外仍保留事务租约。重启先对账发布回执，再回收过期租约。CLI 手动 run-once 只向同一队列幂等入队，不启动第二调度器。
- 默认名单 15 分钟轮询；官方来源北京时间每日 09:00；首次启用账号下次名单同步后立即入队。清理并发 1、每天最多 10 条；每任务超时、输出大小、重试上限及金额预算由项目配置明确设定。空闲等待不调用模型，心跳只写轻量状态。

## 2. GitHub 名单与新账号注册

读取固定 `Adrian-share/foodmap` / `fact-18/beijing-content-003` / `content/watchlists/beijing.json`。先解析 commit，再按该 commit 取文件，防止 ref 移动导致元信息和正文混用。记录 commit SHA、原始 UTF-8 文件 SHA256、ETag、读取时间。304/同哈希不重入队；非法 JSON、403/429、超时保持最后有效名单并分别退避。main 不是本项目开发基线。

`watchlist`：`schema_version=1, city=北京, sources[], video_links?`。UID 和 season ID 用十进制字符串，避免跨 Python/JS 精度变化。主页必须恰好等于该 UID 的 `https://space.bilibili.com/<uid>`；昵称不作为主键。每个 UID 唯一，最多 500 个账号、每账号 100 个合集、2000 条指定视频；整个原始文件 ≤ 512 KiB。指定链接只接受规范 B站 BV URL 和可选 `?p=N`，不能夹带命令、任意 URL、Cookie 或请求头。

附件初始名单的 18 UID 与实际 ledger 已逐项比对。`watchlist.initial.json` 增补了现有证据确认的王波合集 `5780378`，保留当前来源游标；不把空 season_ids 当作丢弃既有历史的指令。后续名单明确移除合集时停止该来源的新调度，历史不删。Pi 发现的新账号只作为 `enabled=false` 建议，由 GitHub 名单拥有者选择启用。

冻结注册流程：

1. Python 校验新名单，事务暂存为 pending_revision。
2. 经固定上传入口发送 `watchlist.sync`，附完整名单、固定 GitHub provenance 和 `expected_registry_revision`。这是持有既有上传权限的业务服务的操作，Pi 没有此工具。Worker 校验配置一致、UID/profile 对应、重复与大小；若需要读取私有 GitHub，凭据另留服务私有配置，不通过名单传递。调用者提供 provenance 不能充当视频作者证据。
3. Worker 原子更新私有 registry，返回 registry_revision；同 commit+hash 幂等，预期 revision 过期返回 409。旧/无注册的新 UID 候选仍拒绝。
4. Python 收到并持久化注册回执后，才激活本地采集集合并入队。上传丢响应时先查回执。后续候选和核验绑定该 registry_revision。
5. `content/ingestion.cjs` 的 known 集合与 `content/catalog.cjs` 的 creator_uids 都须取有效 registry（包含已接受历史账号）。只改采集器会被服务端拒绝；只改导入规则仍会被公开审核拒绝。

禁用/删除停止新发现，保留已公开记录与旧 UID 的历史读取资格。改名不改 UID。官方合集、投稿、指定视频分别用 `(uid, source_type, source_id)` 保存页码、成功范围、next_retry_at、覆盖状态；遇一个旧/置顶 BV 不能代表到达历史末尾。旧候选上传的 season integer 在边界检查为安全整数后转换，禁止溢出。

## 3. Pi 锁版本、真实启动参数和工具

冻结包：`@earendil-works/pi-coding-agent@1.5.2`，真实入口是 `dist/bundle/cli.js`，不是旧教程里的包名/路径。npm 官方 tarball 已按 `dist.integrity` 校验，官方随包 `dist/main.js:472` 区分 `noTools=all` 和 `noTools=builtin`。精确包 SHA512、Node 22.19.0 darwin-arm64 的官方 SHA256 存于 `pi.lock.json`。这是依赖版本证据，不是已安装或已连模型的声明。阶段 2 仍须生成 npm lockfile 并验证实际 `--version`/`--help`。

Python 必须使用 argv 数组、绝对路径、`shell=False`；以下为首个任务的新进程启动模板，`PROVIDER_ID`、`MODEL_ID` 来自项目合法配置，不能保留占位值启动：

```text
/Users/adrian/foodmap-agent-runtime/tools/node-v22.19.0-darwin-arm64/bin/node
/Users/adrian/foodmap-agent-runtime/foodmap/agent/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
--mode rpc
--provider PROVIDER_ID
--model MODEL_ID
--session-dir /Users/adrian/foodmap-agent-state/pi/sessions
--session-id foodmap-TASK_UUID
--no-builtin-tools
--no-extensions
--extension /Users/adrian/foodmap-agent-runtime/foodmap/agent/pi/content-tools.ts
--no-mcp
--no-skills
--no-prompt-templates
--no-themes
--no-context-files
--tools content_read_evidence,content_fetch_metadata,content_capture_frame,content_search_poi,content_submit_extraction
--exclude-tools read,write,edit,bash,powershell,grep,find,ls,codemode,tool_search,mcp__*,list_mcp_resources,list_mcp_resource_templates,read_mcp_resource
```

`PI_CODING_AGENT_DIR=/Users/adrian/foodmap-agent-state/pi/config` 隔离 Pi 配置；cwd 为项目的专用空工作目录。不改变系统 Node、HOME 或原 daemon PATH。Pi 子进程环境只转入最少运行参数与明确 provider 凭据；不继承上传 token、MULTICA_TOKEN、SSH_AUTH_SOCK。不要把 API key 放 argv。模型/provider 未指定或不可用时置 `blocked_model`，当前阶段未发现项目 Pi 配置；不扫描其他进程或认证日志寻找 token。

重要语义：`--no-tools` 禁用所有工具，包括扩展工具，不能把“注册了扩展”当作已能调用。本协议清理模式使用 `--no-builtin-tools` 和上述固定 `--tools`，同时禁止自动加载扩展及 MCP。`--no-tools` 只用于专门的零工具诊断，不用于正常清理。

| 固定工具 | 输入（见 pi_tool_call） | 执行权限 / 结果 |
| --- | --- | --- |
| content_read_evidence | task_id、evidence_id | 只读当前任务登记证据；返回受限内容及哈希，不接受文件路径 |
| content_fetch_metadata | task_id、BV、P、include_subtitles | 官方元数据/字幕；检查任务 BV 和作者；URL 由适配器构造 |
| content_capture_frame | task_id、BV、P、timestamp_ms | 本到访范围原帧；只落图片，返回 artifact_id；失败 blocked_capture |
| content_search_poi | task_id、query、city=北京 | 固定高德 POI 搜索；输出候选及来源证据，不自动批准分店 |
| content_submit_extraction | task_id、extraction | 存一份结构化提案；不能批准、注册账号或发布 |

扩展初始化与每次 session_start/switch 后必须取 `pi.getActiveTools()` 和 `pi.getAllTools()` 生成审计记录，前者应精确等于五个工具，无额外直接/延迟/MCP 可调用项；意外工具应 fail closed。`get_state` 官方响应没有工具清单，不能伪造该字段当枚举证据。本项目可用扩展注册一个固定 `/foodmap-tool-audit` 控制命令，将工具名/版本写到该任务的状态文件；此控制命令不声明为模型工具，Python 仅发送常量文本，审计不调用模型。扩展不动态加载代码，不提供 pi.exec 的封装。工具关闭是框架能力配置，不是操作系统隔离；项目扩展本身是受信代码，内容只作为参数。

### RPC 结算、隔离与恢复

- stdin/stdout 是逐行 JSON（LF）；stdout 仅协议，stderr 持续消费并脱敏。按 request_id 匹配 response，分片缓冲处理半行/多行，拒绝超过 1 MiB 的单条控制/结果记录；图片经受限工具读取，不把任意路径塞入 prompt。一个进程同时只处理一个业务任务。
- `prompt` 的 `success=true` 只代表接受；`data.disposition=started` 才开始当前业务运行；`queued` 在本协议单任务模式视为状态冲突并恢复；`handled` 没启动模型，不能等待必然不存在的 settled，亦不能当清理成功。
- `agent_end` 后仍可能 retry/compaction/继续工作。必须收到本次运行的 `agent_settled` 且 `aborted=false`，读取最后响应/已提交结构化提案，检查 task_id、BV、P、schema 和业务证据才可进入 verifying。模型错误/只有文本/没有提案都失败；settled 不等于结果正确。
- 事件没有 prompt request_id，Python 用持久的 `(process_generation, task_id, session_id)` 关联单个在途任务；开始前排空旧事件并确认 get_state 空闲，禁止两个业务任务依赖同一全局事件流并行结算。
- 首次任务用启动 `--session-id`；后续任务在同一常驻进程使用 `new_session`，检查 cancelled=false，再 `get_state` 保存实际 sessionFile/sessionId，禁止冒用旧上下文。`new_session` 不接受自创 session_id 参数。恢复已有任务使用受限目录内的 `switch_session {sessionPath}`；启动恢复使用 `--session <absolute-file>` 替换 `--session-id`，两者不能同时出现。
- 取消按顺序 `clear_queue → abort → get_state`；`abort` 返回代表空闲，但未先清队列可继续排队工作。等 isStreaming=false、isCompacting=false、pendingMessageCount=0。超时只结束自建 Pi/Node 子进程组，回收本任务租约，不杀 daemon。

### 工具负向验收依据（阶段 2 的 P4 门槛）

本阶段执行了 schema 负向例：bash 工具、任意 URL 操作、任意路径参数、数字 UID、Pi 自写 review、未知字段均被拒绝。它们只证明结构约束。以下真实 Pi/扩展测试尚待实现，不能拿 schema 测试代替：

1. 真实进程审计 active/all 工具清单，确认五个工具可调用、bash/read/write/edit/codemode/tool_search/MCP 不可调用；`--no-tools` 独立诊断应返回零工具。
2. 官方 CLI 能成功加载指定绝对扩展；扩展注册未激活或白名单拼错时启动失败，而不是无声降级到无工具模型。
3. 使用注入文本要求 shell/读私钥/发布、错 BV/UID、目录穿越/外目录符号链接，固定工具均拒绝；输入不得成为 RPC type、slash command 或 argv。
4. 工具内部按已登记 artifact_id 解析路径并检查 realpath、目录归属、符号链接和读取大小；禁止网络重定向到非允许来源，不提供任意 URL/请求头。
5. 每次会话切换与 Pi 恢复重新枚举；模型/provider 实调用、settled、空闲十分钟和恢复证据单列。Node 22.16.0 不满足要求，必须在兼容独立 Node 上验收。

## 4. 清理输出与独立验证

`extraction` 不含 review/approved/verified。Pi 提交 task_id、creator_uid、BV、P、classification、visits、缺项与 evidence_ids。一条视频的多店 visit 分开，描述必须引用原文/原帧时间证据，timestamp 属于本 BV/P/片段。

独立验证器读取适配器登记的实际证据，不能只读 Pi 自填标签：核对官方 owner；原片分店文字/地址与唯一北京 POI；GCJ-02 范围；0≤start<end≤duration；原帧哈希、P、实际 seek 时间、非黑帧、保留原水印；描述和菜品逐项出处。分店歧义、来源受限、截图缺失均 pending；有确定非北京/关闭/迁移证据则 excluded。需要语义判断而不能独立证明时保持待核，禁止“高置信度即通过”。

验证通过才生成 `record`（沿用 creator/video/visit/review），机器 review 固定 reviewed_by、rules_version、verification_id、evidence_sha256 和审核时间。私有 `verification` 包含逐项检查、源证据及 Pi 版本/provider/model/session/settled，不对匿名用户暴露。服务端 stage 再复核结构、哈希、作者注册、证据引用及一致性；review 标签本身不是授权。

新自动发布记录必须至少一张可用真实截图和一条有出处描述（映射到现有 opinions），这比旧 assess 更严格。旧 15 家数据通过 frozen baseline 合并保留，不能强制用新自动 schema 重写旧 records；baseline_accepted、旧详情 ID、已核准截图路径继续有效。`manifest.baseline_version` 必须匹配部署内置版本，Worker 不认识的 baseline 必须拒绝，不能拼出半个版本。

现有截图脚本 `scripts/screenshots.cjs:37` 会 chromium.launch，不能原样用于本任务的授权范围。阶段 3 必须改为复用已授权会话或原流内存/管道取帧；视频、音频、流分片不得落盘。图片可写专用状态目录，不能以封面、AI 图或 fixture 冒充原帧。

## 5. 固定上传通道与操作协议

目标仍然只有 `https://foodmap.shareworld.fun/api/admin/content-ingest`。SSH stdin 外层保持恰好 `{url,method,token,body}`：GET 的 body=null，POST 的 body 为 JSON 字符串。正文按 UTF-8 字节 ≤ 2 MiB，外层 ≤ 12 MiB+4096，响应 ≤ 2 MiB、40 秒总时限不变。每操作设计为一个有界步骤，不持有 SSH 请求等待模型或长任务。客户端 50 秒超时后必须对账，不能断言写入未发生。

旧 raw snapshot 和 `{snapshot,run}` 不增加 operation 字段，沿用旧验证与回执。新操作统一为 `{schema_version:1,operation,request_id,...}`，禁止混入 legacy snapshot。GET 继续返回旧 `revision/discovered_count/counts/last_run`，可增不影响旧客户端的 capabilities、registry_revision、current_publication；按 ID 查询回执采用同一固定 POST 的 receipt.get，不能给固定 URL 加查询串而被中继拒绝。

| operation | 必填业务字段 | 成功语义 |
| --- | --- | --- |
| watchlist.sync | github、watchlist、expected_registry_revision | registry CAS；回执后本地启用账号 |
| blob.chunk | blob_kind、blob_sha256、mime_type、total_bytes、chunk_index/count、chunk_sha256、data_base64 | 单分片持久化；完整且验证后才形成对象 |
| release.stage | manifest_sha256 | 校验完整清单、图片和私有验证依据，生成不可变版本；尚未切指针 |
| release.commit | data_version、expected_parent_version、expected_pointer_etag | 条件切换 current；同 request_id 重试幂等 |
| receipt.get | target_request_id | 只读查指定操作，返回 prepared/committed 等可核验状态 |
| release.rollback | data_version、expected_parent_version、expected_pointer_etag、reason | 新 generation 指向已有完整旧版；不改旧清单 |
| service.heartbeat | instance_id、owner/mode、commit、时间、Pi 状态、队列计数等 | 更新私有服务状态，不触发采集和发布 |

新操作返回 `operation_receipt`。所有成功 HTTP 200；无效 schema/源关系 400、认证失败 401、错误操作方法 405、并发/幂等冲突 409、超限 413、存储不可用 503。不能把 HTTP200 中的 prepared 当作 committed。request_id 使用 UUID，服务端绑定请求原始 body 哈希，同 ID 不同内容返回 idempotency_conflict；每分片和每操作各用稳定 ID。

兼容结论分三层：现有 SSH 中继对 body 内容透明，协议在其 URL/方法/字节限制内可承载；现有 Worker 不支持 operation，会拒绝；现有 uploadInventory 只认候选 revision/last_run，不能拿来校验新回执。需新增 operation 客户端和服务端分支，复用 sshTransport 的能力与限制，不扩大 SSH 权限。R2/Worker 真实兼容仍须阶段 3 R2 验收。

### 图片 / 清单分片

固定原始分片大小 524288 字节，最后一片可短；`chunk_count=ceil(total_bytes/524288)`，index 从 0 开始。base64 必须规范编码并可重新编码相等，每片最大 699052 字符，完整 JSON 请求仍检查 ≤2 MiB。图片总大小 ≤8 MiB，manifest/私有 evidence ≤16 MiB，至多 32 片；图片 MIME/魔数只允许 JPEG/PNG/WebP、32..8192 像素且总像素有资源限额。schema 的跨字段一致性由装配器检查。

分片 key 固定为 `private/staging/<kind>/<blob_sha256>/<chunk_index>`，不接受调用者路径。重复片哈希相同幂等，不同内容拒绝；完整后流式拼接并复算全对象 SHA256、长度和内容格式。manifest/evidence 还必须为有界合法 JSON。暂存缺片只返回 missing_chunks，不发布。过期暂存可在专用清理任务回收，不能删除被当前/保留版本引用的对象。

图片经核验后存 `public/images/<sha256>.<ext>`，同源路由 `/content/images/<sha256>.<ext>` 符合旧 catalog 的平面文件名正则。stage 可使已经通过图像核验的公开图片按哈希可读，但目录尚不引用它；私有证据始终不可匿名访问。发布器/Worker 用固定站点 origin 和由哈希生成的路由检查真实 HTTP200、Content-Type、长度/哈希，成功记录短期校验凭据；任何图失败不切版本。客户端不能指定探测 URL，探测只由服务器固定规则执行。提交前必须仍确认对象存在且校验未失效。

## 6. 完整版本、原子切换、回执与回退

manifest 是完整动态快照，包含当前全部动态 records/images 与 verification_ids、baseline_version、source_commit、rules_version、parent_version、watchlist_revision。不是单次增量 delta：以旧完整快照合并后生成新快照，防止一次发布抹去其他动态店。旧静态 15 店由 baseline 合并，新增记录按原 visit / POI 别名去重。撤回动态记录通过完整新快照省略，保留私有依据。

哈希规则：`manifest_sha256 = SHA256(上传原始 UTF-8 manifest bytes)`；`data_version = "v1-" + manifest_sha256`。manifest 本体没有 data_version，避免自引用循环。Python 固定序列化并保存原 bytes，重试不得重排再声称原 hash。图片及 evidence 同样哈希原 bytes。

R2 布局：

```text
private/content-incremental-v1.json   既有候选兼容对象
private/watchlist-v1.json             注册账号 / provenance / revision
private/service-v1.json               受限心跳和队列摘要
private/staging/...                  未装配分片
private/evidence/<sha>.json           独立核验依据与模型会话元信息
private/receipts/<request_id>.json    操作请求指纹与回执
private/transitions/<request_id>.json 预备切换链（不可变）
public/images/<sha>.<ext>             经核验的公开图片
public/releases/<data_version>.json  不可变 manifest
public/current.json                  唯一可变公开指针
```

pointer schema：`schema_version, generation, data_version, manifest_sha256, previous_data_version, transition_id, committed_at`。ETag 来自 R2 元数据，放回执不放对象自身。首次写用 If-None-Match:*；之后用 Workers `onlyIf:{etagMatches:<raw-etag>}`。返回 null 表示条件写未发生，返回 409；禁止无条件 put 或自动更新 expected 后覆盖别人的新版。parent_version 和 ETag 都须匹配。

回执丢失/并发恢复：先持久化绑定 request_id 的不可变 transition（含 previous_transition_id、expected_pointer_etag、parent_generation），再 CAS pointer。只有从 current.transition_id 沿不可变链可达的 transition 才证明 committed；准备过而不可达不算成功。这样 CAS 成功但 receipt 写失败、甚至随后又发生下一次提交，也能从链中恢复提交事实。receipt.get 若发现已提交应补齐回执；若 parent 仍相同可以重试原 CAS；父版本已变化而 transition 不可达则 version_conflict。不能用“存在 release 文件”推断已经公开。

每次切换只改一个小 pointer 对象。stage 失败、缺片、源关系不成立、图片不可读、CAS 冲突，都保留完整旧版。保留当前和至少前一完整版本及其图片，首版不自动 GC 发布对象；回退同样生成新的 transition/generation，以旧 data_version 为目标，不倒写旧 generation。

## 7. 公开读取、分页与真正 MCP

阶段 3 增加 `/api/content/current` 和 `/api/content/snapshot?data_version=<version>`：前者返回匿名安全 pointer，后者提供经净化的完整目录（shops、visits、creators、videos、image refs），不能含私有 verification、prompt、会话路径、队列或凭据。服务器按 manifest 和 frozen baseline 统一生成，与现有 `catalogData` / `presentation` 使用相同归并、排序与卡片契约，不另造 restaurant 模型。

首页 catalog、nearby、合集、详情和快照响应都附 `data_version`；旧 `version` 同步到该完整版本。一个请求先捕获 pointer，再只从该版本读取清单与图片。分页 cursor 绑定 data_version、查询/筛选和排序起点，下一页请求明确携带版本；被回收版本返回 409 version_expired，提示从第一页重启，不能偷偷混入当前版。详情链接也附 data_version，图片路径按内容哈希稳定。

current 读取不使用超过 30 秒的缓存（响应 no-store），不可变 manifest/图片可长期缓存。每个实例只在完整验证后替换缓存；异常返回已验证完整旧版并标识其 data_version，或明确带 baseline 标识的静态 fallback；不能混合新指针和旧 JSON。发布成功后 ≤60 秒的新请求可见由 R4 实测，不以设置了缓存时间代替证明。

MCP 当前真实配置是 `config/workbuddy/mcp.json` 的 `http://127.0.0.1:8767/mcp`，处理器为 `mcp-server.cjs`，入口 `amap-server.cjs`；正式 Sites Worker 未注册 /mcp，平台也确认未声明 MCP。本协议选择保留该本地 HTTP MCP 入口，由 Node 读取上述官方公开 snapshot，每次工具调用固定版本后复用既有附近排序/卡片逻辑；Python 不承担 MCP 服务。原 MCP 客户端所在机器负责运行 Node 服务，本轮 Mini :8767 未监听，其他机器会话没有核实。阶段 3 必须在实际客户端配置所指机器更新并调用 MCP，不能只在 Mini 测 fixture。若需要新托管的云端 MCP，应作为独立部署决定，不默认改变当前入口。

## 8. 私有后台与调度切换

沿用 ChatGPT 登录边界及身份头，worker 只在既有可信 Sites 网关后消费身份，不把用户自填身份头作为独立安全证明。后台新增 `/api/admin/service-status`，读取私有 heartbeat、来源范围、失败/退避、队列阶段、注册版本与发布回执。公开 API 永不读取私有状态；原 creators/videos 仍能回查 92 个旧 BV。无新增、退避未检查、源失败、模型失败、发布失败各自计数。

协调者的唯一切换顺序（本阶段不执行）：

1. 隔离状态跑 W/P/C/R 测试，验证真实 Pi、工具白名单、恢复和一次正式发布；总验收要求 E1 新店、E2 三站、E3 自身定时。
2. 暂停旧 Autopilot `9d7d3391-9e85-4a55-baae-8294bc33e15e`，等待其已有采集/上传完成，核对锁与最后回执；保留历史，不能伪造失败记录。
3. 从最后成功状态迁移，安装最终同一代码版本的 Python 服务并启用 production 调度。记录 scheduler_owner=python、旧触发器状态、源 commit、公开 data_version。
4. 回退时先停止 Python 并确认 Pi/适配器退出、写锁释放、所有在途发布对账，再恢复旧 Autopilot active；需要回退公开内容时另走 release.rollback。不能先启旧后停新。

CLI 使用运行 brief 规定的 `"$MULTICA_CLI_PATH" autopilot update <id> --status paused|active`。Python `serve/status/run-once/sync-watchlist/export-report` 及 launchd 安装/停止命令由阶段 2 提供实际文件后定稿；本阶段不把尚不存在的命令描述为已可用。

## 官方来源与版本证据

- [Pi 1.5.2 官方 npm 元信息](https://registry.npmjs.org/@earendil-works/pi-coding-agent/1.5.2)：精确 tarball / integrity / Node engines / bin 已下载核对。
- [Pi CLI](https://docs.pi.dev/latest/cli)、[RPC](https://docs.pi.dev/latest/rpc)、[RPC 命令](https://docs.pi.dev/latest/rpc-commands)：线上参考可能变化，实际冻结以同版本 tarball 的 docs 和 dist 源码为准。
- [Pi 官方源码](https://github.com/earendil-works/pi/tree/main/packages/coding-agent)：包身份与实现出处；未把移动的 main 当锁定版本。
- [Node 22.19.0 官方校验清单](https://nodejs.org/dist/v22.19.0/SHASUMS256.txt)：只核对安装目标，未更改系统 Node。
- [R2 Workers API 条件写](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)：onlyIf / etagMatches 及条件失败语义；真实发布恢复由 R1 验收。
