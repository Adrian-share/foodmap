# 候选上传专用 SSH 通道

## 当前证据

| 已确认结果 | 依据 | 状态与范围 |
| --- | --- | --- |
| Mac mini 可通过固定 SSH 服务完成 POST 与 GET 持久读取 | 2026-11-16 实际 run `94be604d-eea7-4544-94da-8921c574d90f`，uploaded=true，revision=2 | 普通 HTTP 客户端受阻时使用此通道；不改变浏览器访问路径 |
| 服务只能访问固定候选接口 | `upload.py` 的目标、方法、字段、大小和超时校验 | 只接受本站 `/api/admin/content-ingest` 的 GET/POST |
| 专用账号拒绝 Shell 与转发 | `ssh foodmap-uploader id` exit=1；`ssh -W127.0.0.1:22 foodmap-uploader` exit=255 | 服务端 ForceCommand、restrict 和逐账号 sshd 限制 |
| 中文正文按 UTF-8 上传 | Python 回归测试及实际中文台账上传 | `http.client` 接收 UTF-8 bytes，避免默认 Latin-1 字符串编码 |
| 专用执行器已获授权并通过真实执行 | 正常Run now与20:20计划触发均completed；最新回执revision=10 | 原DSH沙箱不改，采集子进程另有固定目录写入沙箱 |

## 配置入口

执行机固定代码目录为 `/Users/adrian/foodmap-agent-runtime/foodmap`。上传者从私有配置 `~/.config/foodmap/ingest.env` 读取参数。

| 配置 | 用途 |
| --- | --- |
| `FOODMAP_SITE_URL` | `https://foodmap.shareworld.fun` |
| `FOODMAP_UPLOAD_SSH_HOST` | `foodmap-uploader`，执行机的固定 SSH 别名 |
| `FOODMAP_INGEST_TOKEN` | 本站候选接口令牌；只保存在私有运行配置与 Sites secret |
| `FOODMAP_AGENT_STATE_DIR` | 固定进度、退避、每轮快照和回执目录 |

令牌只经 SSH stdin 传输，不放在 argv、任务文本或源码。SSH 私钥仅在 Mac mini，权限600。主机公钥由已有受信连接取得并固定在专用 known_hosts，严格校验保持开启。

服务器账号 `foodmap-sync` 的 home 为 `/var/lib/foodmap-sync`，authorized_keys 由 root 管理，带 `restrict`。`/etc/ssh/sshd_config.d/42-foodmap-sync.conf` 限制该账号：

```text
Match User foodmap-sync
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    PermitTTY no
    AllowTcpForwarding no
    AllowAgentForwarding no
    PermitTunnel no
    X11Forwarding no
    ForceCommand /usr/bin/python3 /usr/local/lib/foodmap-sync/upload.py
```

`upload.py` 与 home、公钥配置由 root 持有。配置变更先运行 `sshd -t`，再 reload；用 `sshd -T -C user=foodmap-sync,host=localhost,addr=127.0.0.1` 核对有效策略。账号与权限新增需明确授权。

## 传输契约

stdin 是一个 JSON 对象，恰好包含 `url`、`method`、`token`、`body`。GET 的 body 必须显式为 null，POST 的 body 是 JSON 字符串。正文最多2MiB；外层允许 JSON 转义扩张但有12MiB+4096上限；响应最多2MiB；服务总时限40秒。

服务返回 `{status, body}`。客户端要求 HTTP200、有效 revision/discovered_count/last_run，并在 POST 后用同一认证 GET 核对持久状态。错误输出不回显服务 stderr。该通道没有任意 URL、任意命令或文件上传能力。

```sh
node scripts/refresh-and-upload.cjs --help
npm run test:refresh
```

正常采集命令的 stdout 是安全 JSON 摘要。uploaded=true 只代表候选已持久同步；公开门店仍需核准分店、POI、片段和截图并批准批次。生产进度或 credential 文件不提交仓库。

## 专用任务执行器

`scripts/multica-foodmap-runtime.cjs` 已注册到 Multica，兼容 JSONL v1 的 probe/models/execute/cancel。它不调用模型，不执行任务文本中的命令，不加载 MCP，也没有开发 Shell 或文件编辑工具。只启动固定安装目录里的 `refresh-and-upload.cjs`，并核对本轮 report 与 receipt。每次进程只接受一轮采集，完成后退出，即使stdin保持打开或缓存多条execute。

任务执行器只使用平台正常注入的任务凭据回报本轮评论和状态；采集子进程不继承 MULTICA_TOKEN。平台凭据缺失会报错，不读其他进程环境或恢复被清洗的凭据。已有 DSH 编码 Agent 的 workspace-write 策略保持原样。

| 路径或通道 | 固定用途 |
| --- | --- |
| `/Users/adrian/foodmap-agent-runtime/foodmap/scripts/refresh-and-upload.cjs` | 只执行已安装、已测试的代码 |
| `/Users/adrian/foodmap-agent-runtime/foodmap/content/inventory/incremental-state.json` | 更新可构建候选快照 |
| `/Users/adrian/foodmap-agent-state/` | 持久进度、锁、每轮快照、报告及上传回执 |
| 本机私有 ingest.env 与 SSH 配置 | CLI自行读取，内容不进任务或日志 |
| 固定 B站官方来源、候选导入接口与 Multica CLI | 来源采集、持久上传及平台回报 |

`collector.sb` 仅允许写进度目录、候选快照及其临时文件，其他写入拒绝；目录外写入与符号链接绕过的实际负向验证均通过。取消先让采集合作式中止并释放锁，同时终止受控进程组；1秒宽限后SIGKILL兜底，等整个组退出再返回。强制清理只接受首次捕获、已退出child PID持有、文件身份未变且距10分钟陈旧窗口尚有30秒余量的新锁。其他PID、替换、旧锁和符号链接均保留。已提交的服务端候选不会因客户端取消而撤回。

| 配置 | 当前值 |
| --- | --- |
| Runtime profile | `0a58e182-5cdb-4f94-8787-61f1a6a679fc` |
| Mac mini runtime | `5c17abbe-8b3e-4cb4-9d3b-75af21131fec` |
| 专用Agent | `2783a44b-d346-4c71-a393-bb017407b73e`，private，max_concurrent_tasks=1 |
| Autopilot | `9d7d3391-9e85-4a55-baae-8294bc33e15e`，active，create_issue |
| 唯一正式触发器 | `b744a35f-f3b1-4553-a435-ba7392a75154`，`0 9 * * *`，Asia/Shanghai |

2026-11-16真实计划于20:20:19触发，20:20:50完成，回执revision=7。取消实测确认采集和SSH子进程均退出、锁无残留、daemon继续运行；随后正常Run now于20:46:18完成，revision=10。临时触发器已删除。Mac mini Multica daemon已启用登录自启并保留Node所需PATH；运行依赖Mini联网、已登录及SSH22可达，MacBook可离线。冷启动仍需完成FileVault解锁及用户登录。

执行器22项、增量/导入/SSH/CLI取消57项检查在两台Mac均通过。每轮安全摘要自动回写对应Multica任务，报告和回执保留在固定进度目录。

```sh
npm run test:agent
node scripts/multica-foodmap-runtime.cjs --probe
node scripts/multica-foodmap-runtime.cjs --list-models
```

停用与恢复：对上述Autopilot执行`multica autopilot update <id> --status paused`或`--status active`。查询用`autopilot get`、`trigger-list`和`runs`。删除临时触发器的语法为`autopilot trigger-delete <autopilot-id> <trigger-id>`。CLI返回正在执行的session时先等待完成再解析JSON；写操作回执缺失时先核对平台状态，避免重复提交。

## FACT-33 内容版本操作

同一固定接口现在有已实现但待协调者部署的新 operation；不要在旧v10上将404解释为没有内容。客户端显式发送真实项目 User-Agent 与 Accept，403/404均失败。上传器仍只允许原目标 GET/POST，正文≤2MiB；未增加 SSH shell 或任意 URL。

详细运行与验收边界见 `docs/verification/FACT-33/README.md`。新操作可以用原私有配置通过 `scripts/agent-operation.cjs` 发送 UTF-8 JSON 文件；文件中只填冻结 operation 字段，不放 token：

```sh
# operation.json 是 receipt.get 或经核对的 release.rollback 请求；配置只传文件路径
# 使用项目绝对 Node；凭据由客户端读取，不出现在 argv 或报告
./tools/node-v22.23.5-darwin-arm64/bin/node scripts/agent-operation.cjs "$HOME/.config/foodmap/ingest.env" < operation.json
```

回退请求必须带已有完整旧 `data_version`、当前 `expected_parent_version`、当前指针原始 ETag、新 UUID 和真实 reason。先 GET/receipt.get 对账，不能自动更新 expected 值覆盖别人的新版。回退增加 generation，保留清单和图片。

Python生产服务由父协调者安装。默认 preview 只形成私有 staged 计划；显式 `--mode production` 才发布。模型私有配置只进入 Pi 子进程，上传配置绝不传给 Pi。

```sh
# 仅渲染可审阅生产托管文件，尚不加载；先确认旧生产调度已暂停并排空
./tools/venv/bin/python deployment/foodmap-agent/render-launchd.py /Users/adrian/foodmap-agent-state/python \
  --mode production --online \
  --model-config /Users/adrian/foodmap-agent-state/pi/model-private.json \
  --upload-config "$HOME/.config/foodmap/ingest.env" > foodmap-agent.plist

./tools/venv/bin/python -m foodmap_agent --state /Users/adrian/foodmap-agent-state/python status --json
./tools/venv/bin/python -m foodmap_agent --state /Users/adrian/foodmap-agent-state/python run-once --json
./tools/venv/bin/python -m foodmap_agent --state /Users/adrian/foodmap-agent-state/python sync-watchlist --json
```

协调者将渲染文件放入用户 LaunchAgents 后使用 `launchctl bootstrap gui/$(id -u) <已核对plist>` 启动。停止用 `launchctl bootout gui/$(id -u)/com.adrian.foodmap-agent`；检查自建 Pi/适配器退出、租约/在途回执核对后，才用 `"$MULTICA_CLI_PATH" autopilot update 9d7d3391-9e85-4a55-baae-8294bc33e15e --status active` 恢复旧触发。切换时同一命令的 status 为 paused，且须先排空旧运行。不要按进程名杀服务或 Multica daemon。

本次开发没有执行上述安装或切换。MCP仍是既有本地 Node `/mcp`；将客户端机器更新为相同源码，用 `FOODMAP_CONTENT_ORIGIN=https://foodmap.shareworld.fun`、`DATASET=verified` 运行，模型地点模式按该机器既有高德配置。它每次调用读取公开 current/snapshot，不在云端新建 MCP。
