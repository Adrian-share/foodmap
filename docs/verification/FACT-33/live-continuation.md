# v11 接续：本地适配修复与正式协议验证

保留协调者 `14da6a798880a1775a6f22d06f95472dcfa8b11b` 的 MCP 发现/输出 schema 修复。Sites 仍由 root 独占发布；本轮没有改 Worker handler、独立核验规则、C2 或冻结 schema。

## 固定网络与原帧

`agent/pi/public-http.mjs` 只运行当前项目的 `tools/venv/bin/python -I scripts/agent-public-json.py`；stdin 只能是固定 POI 操作及≤80字符查询，URL由受信代码构造。子环境仅保留 HOME/TMPDIR/LANG/LC_ALL/SYSTEMROOT 与固定 PATH；不继承模型、上传、SSH、Multica 凭据。Python继续使用既有系统网络配置；403/404、重定向、超时、超限均失败，不生成“空POI”。红绿测试和真实净化环境响应随证据包交付。

默认请求匿名 qn64，记录实际返回 quality 与原始 PNG 尺寸/哈希。原流以有界、带背压的管道送给 ffmpeg，选定帧完成即停止读取；128MiB流量上限保留，音视频与流分片不落盘。修复前某候选读取整条视频超时，修复后已实际取得同 BV 的720×1280原帧。

原始 PNG 始终用于证据/OCR与独立核验。模型只接收单张≤24KiB、全任务≤96KiB的JPEG预览，记录 source_sha256，不可将预览作为独立原帧。冻结1MiB JSONL上限未改变。真实Pi已收到3个image block、最大行122987字节且正常settled；来源不足仍pending。

## 名单与调度事实

真实 canonical 配置提交 `ffe2a8e242219a361e36971012c8686f7bc11ccd` 新增原官方 view 核对的“鲁菜行者”UID `490775325` 及 BV `BV1GC4y1B7Cj`。原18来源、王波合集与92 BV/15店基线保留。固定SSH注册revision 1→2，复读unchanged；同BV两次真实view检查只有1实体和1任务，隔离队列共93 BV。仅核对了指定view，未把它报告为账号全历史。

隔离 Service.serve 的 next_source_at 被明确设为启动后5秒，实际定时跑完一次官方view，模型请求数不变；不算作原09:00或生产周期完成。受控Python强杀后Pi随控制管道退出，未发现需新增父进程退出机制的缺口。旧Autopilot继续active。

## 本轮允许的初始化

质量选择由root等待用户回复，原C2保持。root已明确允许：在既有 live-continuation 状态中，使用原schema的零records/images/verification_ids，真实初始化一个仅保留 frozen 15店的动态版本。入口 `scripts/stage3-initialize-release.py` 先核对15个公开visit ID、baseline和registry；已有动态版本就拒绝覆盖。该操作验证固定SSH、R2 stage/CAS、提交成功后客户端未落盘的回执恢复、公开同版读取。净增始终为0，不勾选E1或R3新增店。

恢复用同一个状态目录、同一原始manifest字节和稳定request ID；禁止另建空状态绕过 parent 或 rebase_required。正式 data_version、完整回执和计时以实际运行的 `real-baseline-release.json` 为准，不把代码或本地fixture当成执行成功。

## Preview 持久托管准备

生产安装和调度切换仍由FACT-30协调。本轮仅生成可审阅preview plist及安装计划，不加载launchd，也不启动第二生产调度器。协调者在专用运行副本安装同一提交和锁定工具后，用已有render-launchd.py渲染preview；默认offline，可持续维持Python/Pi心跳而不调用模型、不采集、不发布。要做隔离在线预览时必须使用已恢复真实checkpoint的独立状态，preview模式继续禁止公开commit。

```sh
./tools/venv/bin/python deployment/foodmap-agent/render-launchd.py /Users/adrian/foodmap-agent-state/python-preview \
  --mode preview --model-config /Users/adrian/foodmap-agent-state/pi/model-private.json > foodmap-agent-preview.plist
```

保持原模型0600文件；不向Pi或公共HTTP子进程传发布/Sites凭据。受控诊断均前台完成，任务结束无后台工作。E1新店、动态新增后的三站/实际MCP、播放推进、未修改周期的持续生产运行和最终单调度切换仍待验收。
