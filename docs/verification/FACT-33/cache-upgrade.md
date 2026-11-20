# FACT-33 缓存与北京合集升级候选

本候选等待 root 源码复核。运行服务仍是 885f205，唯一 label 为
`com.adrian.foodmap-agent`，owner=python / mode=production；旧 Autopilot
9d7d3391-9e85-4a55-baae-8294bc33e15e 已 paused。尚未安装本候选，尚未修改正式 GitHub 名单，Sites 不变。

## 已证实的问题与变更

- 两条 TimeoutError 任务已各尝试三次，分别保存 30/27 张真实原帧；不能自动重领，不能重置次数或每日预算。本候选不修改其状态。
- 每次取帧重新读取完整 view，使同任务 metadata 哈希随统计字段变化；模型还读到整份合集。现仅复用经 BV/P/作者校验、24 小时内的已注册响应，完整响应和原哈希仍保存；只在模型展示层投影当前视频字段。
- 超时后已完成的工具证据没有复制回 Python，下次又丢失登记表。现同步同一任务上下文并持久保存，校验 task/UID/BV/P/root，原帧复用前检查实际字节、SHA、CID、时间和 OCR 绑定。
- 每次尝试最多三张新帧，已有总预览预算不重置；提交成功后停止继续取帧。每日 10 次业务尝试、8192 输出 token、180 秒、最多三次尝试保持。
- root 发现同 BV 在重试间增加来源/改标题时 discovery 文件和旧 descriptor 不匹配。新增测试先红；修复保留本次 discovery descriptor，同时保留 metadata/原帧缓存，不忽略哈希错误。
- 两个已启用账号增加配置化锚点；保留原王波 5780378 和普通合集接口。完整列表验证包括逐集作者、完整计数及唯一 BV；增加稳定列表 SHA，与原始响应 SHA 分别记录。
- production 重启保留同一运行库里的来源和名单自然到期时间。
- 验收引用检查实际文件、哈希、fixture 标志和 data_version；R4/E3 仍 pending。

## 来源证据与测试

2026-11-18 11:01（北京时间）隔离状态真实检查只发三次来源请求：

| UID | 合集 / 锚点 | 完整列表 | 库外 BV / 已有 BV |
| --- | --- | --- | --- |
| 3546888255048212 | 5622142 / BV1fzhM6iE5k | 13 | 11 / 2 |
| 1781681364 | 956796 / BV1d94y1j7Ag | 114（100+14） | 113 / 1 |

作者均匹配；第二次扫描没有请求、没有新增。生产仍为 19 UID / 93 BV / 16 店；隔离库的 124 个新增不是生产发现或公开。root 另以两次官方完整 view 独立复核并保存原始响应。

证据通过 Multica 附件交付，不提交模型会话或私有运行库到 GitHub：
`production/red-attempt-cache.*`、`red-multi-anchor.tap`、
`red-discovery-retry.log`、`green-discovery-retry-python.log`、
`green-new-cache-and-anchor.tap`、`green-publication-cache-final.tap`、
`regression-cache-npm-final.log`、`added-collections/live-results.json`。

## 安装顺序（尚未执行）

1. root 复核本候选 SHA 和实际 diff 后，在专用 releases 目录从该 SHA 建 detached worktree，运行已有 `deployment/foodmap-agent/install.py`，核对工具锁版本及相关安装后回归。此时不启动第二个服务。
2. 只读复读当前旧 tasks、Autopilot paused、唯一 label、租约、Singleton、prepared receipts；有在途任务先排空，有未确认提交先查固定 SSH receipt.get。
3. 停唯一 production label，确认其 Python/Pi 已退出。对同一 `python-preview` 状态做 SQLite 一致备份，哈希 evidence、Pi session、receipts、manifest、cursor、每日预算及 protected service_state；凭据配置不进入包。
4. 保持 label/owner/state/model-config/upload-config，仅把 plist 中代码及独立工具路径切到候选 SHA；沿用同一 SQLite，不 seed、不换诊断库、不重置失败次数。启动一次 production，验证单进程、Pi 五工具、健康心跳及 committed 回执、新 source_commit、旧 trigger paused、原公开 generation2 和预算不变。
5. **安装和健康验证之后**，CAS 更新实际集成分支 `fact-18/beijing-content-003` 的 `content/watchlists/beijing.json`，只给现有两个 enabled 账号追加 season_ids；保留全部 19 UID、其他合集和单视频。保存名单 commit/blob/SHA，不能把应用 SHA 当名单 SHA。
6. 等唯一生产服务默认 900 秒轮询自然读取新名单，经现有注册协议激活，再由现有调度扫描来源。禁止注入 run_once/sources_due；记录新 BV 与旧 BV 首次入队的不同计数。

自然来源仍为 Asia/Shanghai 09:00；2026-11-19 09:15 单次只读观察 wakeup 已建立，ID `01a1ec86-5e07-7079-97b2-8bbba5f3b6fe`。R4 须留给下一次真实核准发布，记录 commit 与连续公开读取的首次新版可搜时间；当前 63.482 秒的晚读不算 60 秒通过。

## 回退

升级失败先停新 production label，核对进程、锁、最后 committed 回执和最新 SQLite，再恢复前一 885f205 production plist；始终保持旧 Autopilot paused，避免两个 owner。不得用旧备份覆盖升级后已提交数据。

如需完全恢复 legacy，先停 production 并排空、核对最新回执，再恢复旧 Autopilot；只有确认唯一 owner 后才按需加载原 preview。公开内容回退另用已有固定 release.rollback 和当前 ETag/稳定 request_id，不能以恢复旧 SQLite 代替内容回退。生产异常时不得让旧、新两个 owner 同时运行。
