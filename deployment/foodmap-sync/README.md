# 候选上传专用 SSH 通道

## 当前证据

| 已确认结果 | 依据 | 状态与范围 |
| --- | --- | --- |
| Mac mini 可通过固定 SSH 服务完成 POST 与 GET 持久读取 | 2026-11-16 实际 run `94be604d-eea7-4544-94da-8921c574d90f`，uploaded=true，revision=2 | 普通 HTTP 客户端受阻时使用此通道；不改变浏览器访问路径 |
| 服务只能访问固定候选接口 | `upload.py` 的目标、方法、字段、大小和超时校验 | 只接受本站 `/api/admin/content-ingest` 的 GET/POST |
| 专用账号拒绝 Shell 与转发 | `ssh foodmap-uploader id` exit=1；`ssh -W127.0.0.1:22 foodmap-uploader` exit=255 | 服务端 ForceCommand、restrict 和逐账号 sshd 限制 |
| 中文正文按 UTF-8 上传 | Python 回归测试及实际中文台账上传 | `http.client` 接收 UTF-8 bytes，避免默认 Latin-1 字符串编码 |
| DSH 临时工作区不能写当前固定状态目录 | Multica FACT-23 实际 EPERM：创建 incremental-state.json.lock 被拒 | 调度执行范围待授权；不能把上传服务已通过称为定时已通过 |

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

## 专用任务执行器方案（待授权接入）

`scripts/multica-foodmap-runtime.cjs` 是可注册到 Multica 的固定任务执行器，兼容 JSONL v1 的 probe/models/execute/cancel。它不调用模型，不执行任务文本中的命令，不加载 MCP，也没有开发 Shell 或文件编辑工具。只启动固定安装目录里的 `refresh-and-upload.cjs`，并核对本轮 report 与 receipt。取消只中止本轮子进程。

任务执行器只使用平台正常注入的任务凭据回报本轮评论和状态；采集子进程不继承 MULTICA_TOKEN。平台凭据缺失会报错，不读其他进程环境或恢复被清洗的凭据。已有 DSH 编码 Agent 的 workspace-write 策略保持原样。

| 路径或通道 | 固定用途 |
| --- | --- |
| `/Users/adrian/foodmap-agent-runtime/foodmap/scripts/refresh-and-upload.cjs` | 只执行已安装、已测试的代码 |
| `/Users/adrian/foodmap-agent-runtime/foodmap/content/inventory/incremental-state.json` | 更新可构建候选快照 |
| `/Users/adrian/foodmap-agent-state/` | 持久进度、锁、每轮快照、报告及上传回执 |
| 本机私有 ingest.env 与 SSH 配置 | CLI自行读取，内容不进任务或日志 |
| 固定 B站官方来源、候选导入接口与 Multica CLI | 来源采集、持久上传及平台回报 |

接入涉及新增一个专用 Multica runtime/profile 和 Agent，仅供北京增量 Autopilot 使用。注册前需取得专用运行范围授权。源码和6项协议验收已完成；真实平台兼容、任务凭据注入和计划触发仍须接入后实测，不能以单元测试替代。

```sh
npm run test:agent
node scripts/multica-foodmap-runtime.cjs --probe
node scripts/multica-foodmap-runtime.cjs --list-models
```
