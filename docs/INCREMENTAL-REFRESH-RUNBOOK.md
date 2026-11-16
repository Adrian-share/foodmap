# 北京探店视频定时增量刷新运行手册

本手册面向运营与值守代理，说明 `scripts/refresh-creator-inventory-incremental.cjs` 的用法、数据文件、候选流转、调度与恢复方式。

## 1. 这个脚本做什么

脚本从 B 站公开接口做一次**可重复、增量、幂等、并发安全**的刷新：

- 对 17 个种子 UID（以及台账中新增的 UID）逐个抓取公开投稿列表第 1 页（`/x/space/wbi/arc/search`），记录入口是否受限。
- 对尚未登记的候选 BV 抓取视频元数据（`/x/web-interface/view`）；成功响应会登记当前视频，即使没有附带合集。只有已知 UID 且作者匹配的元数据进入构建快照。
- 每轮优先检查厨者王波的固定官方入口 `BV1NG6kYTEXG`，识别北京合集 `5780378` 的分集变化。冻结证据在 2026-11-15 取得 61 条；当前条数以本轮报告为准。固定入口也遵守失败退避和请求预算。
- 与历史证据合并：发现按 `creator_uid:bvid:source` 去重并保留最早 `discovered_at`；账号保留最新检查结果及独立的 `last_success_at`、`last_success_range`；合集按最新检查时间合并；视频元数据保留最后成功结果。网络异常、HTTP 412、接口 code -403 等失败均走指数退避。
- 不绕过登录/验证，不把「未返回列表」当零视频，不宣称账号历史完整。

取得锁并完成刷新后，写一份 JSON 报告，并在 stdout 打印摘要。锁被占用时只返回 `locked`；初始化错误时退出码为 1，保留原状态，不产出成功报告。

## 2. 数据文件

命令从 **仓库根目录**运行（`foodmap/`，即 `scripts/` 和 `content/` 的上一级）。持久状态保存在运行机的固定目录，避免临时 checkout 被清理后丢失退避和发现进度。

`FOODMAP_AGENT_STATE_DIR` 指定持久目录；未设置时默认为运行用户的 `~/foodmap-agent-state`。同一生产任务在每轮运行中必须使用同一个目录。

| 文件 | 说明 |
| --- | --- |
| `$FOODMAP_AGENT_STATE_DIR/incremental-state.json` | 持久状态，包含 `schema`、`updated_at`、`discoveries`、`accounts`、`seasons`、`videos`、`failures`。在锁内读取和原子写入。首次初始化先导入仓库已有增量快照；没有快照则从冻结 access 文件播种。 |
| `$FOODMAP_AGENT_STATE_DIR/incremental-state.json.lock` | 写入运行 PID 的互斥锁。父目录不存在时自动创建；用 `openSync(...,"wx")` 获取。只有锁超过 10 分钟且 PID 已不存活时才清理重试；仍被占用则返回 `locked`，不读取或改写状态。 |
| `$FOODMAP_AGENT_STATE_DIR/runs/<checked_at 净化>/report.json` | 运行报告，含 `run_id`、`outcome`、`partial`、`sources_*` 计数、`new_candidates`、`duplicate_count`、`pending_total`、`last_success_ranges`、`errors`。保留在运行机，不提交仓库。 |
| `content/inventory/incremental-state.json` | 可构建的增量快照，只含 `schema`、`updated_at`、`discoveries`、`accounts`、`seasons`、`videos`。不含 `failures`、锁或运行报告。视频只保留 BV、作者 UID、标题、发布日期、时长、合集 ID、官方接口来源和核对时间，不保存原始响应、凭据或媒体流地址。 |
| `content/inventory/access-2026-11-15.json`、`content/inventory/video-inventory-2026-11-12.json` | **冻结文件，永远不要修改**。前者是历史证据与首播种子，后者是种子台账。 |

## 3. 命令

```sh
# 正式运行（写状态、写报告、按默认上限 60 次请求）
node scripts/refresh-creator-inventory-incremental.cjs

# 远程 Agent 使用固定持久目录，跨 checkout 复用
FOODMAP_AGENT_STATE_DIR="$HOME/foodmap-agent-state" node scripts/refresh-creator-inventory-incremental.cjs --json

# 只算计划并打印，不抓取、不写任何文件
node scripts/refresh-creator-inventory-incremental.cjs --dry-run

# 打印最终报告为 JSON（供脚本/值守代理解析）
node scripts/refresh-creator-inventory-incremental.cjs --json

# 覆盖参数（测试/临时运行用；状态必须与仓库快照分开）
node scripts/refresh-creator-inventory-incremental.cjs --state <path> --runs-dir <path> --limit <n>
```

返回值字段含义（`report.json` / `--json`）：

| 字段 | 值守判断 |
| --- | --- |
| `outcome` | `new_content`：本轮计划来源均检查成功且有新 BV；`no_new`：均检查成功且无新 BV；`partial`：部分失败、受限、退避或因预算漏检；`failed`：本轮尝试全部异常失败；`deferred`：零请求且所有来源仍在退避；`incomplete`：零请求且预算不足或无可执行来源；`locked`：另一运行持锁。 |
| `partial` | 本轮有来源未成功核对时为 `true`。即使发现新候选，也不能把漏检解释为完整刷新。 |
| `sources_deferred` / `sources_skipped_limit` | 分别记录退避跳过和预算跳过的来源数。请求上限只限制本轮请求，不表示来源已经核对。 |
| `last_success_ranges` | 每账号的最新检查时间、HTTP/code/error、限制，以及独立的最后成功时间和范围；失败不会抹掉成功范围。 |
| `new_candidates` / `duplicate_count` | 前者是本轮首次遇到的 BV，后者是本轮发现但 BV 已在已知集合里的条数。已存在种子台账的 BV 可以补齐元数据而不增加 `new_candidates`。 |
| `pending_total` | 当前输入台账待核 BV 数，加上本轮会新增的已核实作者候选。最终合并数以构建后的台账为准。 |

## 4. 候选如何进入私有台账（待核）与发布边界

- 刷新只产出「发现」证据，写入 `incremental-state.json`，**不直接改公开内容**。
- `npm run content:build` 时，`scripts/build-content.cjs` 会把快照中的 `discoveries`、`accounts`、`seasons`、`videos` 合并进 `access`（冻结文件本身不动），再由 `buildLedger` 生成台账。成功 view 的标题和发布日期通过 `access.videos` 进入同一后台台账；较新的失败响应不会覆盖成功元数据。
- `buildLedger` 只把「UID 已知 + `owner_verified === true`」的发现登记为待核（pending）视频；它们只出现在登录后台（`/admin/creators/`、`/api/admin/*`），**公开数量不变**。
- 只有走批次审核（`content/batches/*.json`）核准分店、POI、截图等证据并重新构建后，视频才进入公开列表，公开数才增加。所以：**新候选停在待核，等批次批准后再公开**。

## 5. 验证方式

```sh
# 增量脚本的单元测试（mock 抓取，无网络、无需 undici）
node --test tests/incremental-refresh.test.cjs

# 重建台账（不依赖 node_modules，只用 Node 内置模块）
npm run content:build

# 逐账号覆盖与逐 BV 处理结果导出
node scripts/export-creator-report.cjs
```

核对要点：`npm run content:build` 输出里 `discovered_videos` 是否随新候选增加；`node scripts/export-creator-report.cjs` 的 `coverage.csv` / `video-outcomes.csv` 中新增 BV 状态是否为「待核」且未进入公开。

## 6. 调度（Multica Autopilot）

生产触发的实际启用状态，以 Autopilot 配置和触发运行证据为准。

- 方式：Multica Autopilot 的 **create-issue 模式**，每天 **09:00 Asia/Shanghai** 触发一次。
- **只保留一个生产触发**，并在其执行环境固定 `FOODMAP_AGENT_STATE_DIR`。每轮使用同一运行用户和持久目录；checkout 中只提交可构建的增量快照。
- 首次启用顺序：
  1. 先「Run now」手动跑一次，记录 run id / 结果 / 下次执行时间；
  2. 再建一个**近时间**（几分钟后）的临时调度，确认触发按计划执行、report 正常；
  3. 确认后把生产调度固定在每日 09:00 Asia/Shanghai，删除临时调度。
- 每次触发后保留：触发时间、run id、`outcome`、下次执行时间，便于回溯。

## 7. 停止与恢复

- **停止**：删除或禁用对应的 Multica Autopilot 触发，不再有新一轮运行。
- **恢复**：状态文件采用同目录 `.tmp` + `rename` 原子写入，中断后原状态仍可读取。重新运行使用同一持久目录，历史发现与成功范围保留，失败源按 `next_retry_after` 退避。指数退避从 2 分钟起，连续失败翻倍，最多 60 分钟；成功后清除该源的退避记录。
- **损坏状态**：JSON 无法解析、字段类型错误或 schema 不受支持时，脚本报错并保留原文件，锁仍会释放。先备份损坏文件和仓库快照，核对最近成功报告后修复或恢复，不能通过静默重新播种来宣称恢复成功。
- **重置**：会丢弃冻结证据之后的增量进度，须先备份并人工确认。检查持锁 PID 已结束后，才可处理持久状态和快照；仅删除仓库快照不会重置运行机状态。删除持久状态后，脚本优先从剩余快照初始化。
- **锁残留**：正常退出及初始化异常会释放锁。进程被杀后，锁超过 10 分钟且 PID 不存活时自动清理。活 PID 的锁不会被抢占；人工处理前先核对进程，避免并发改写状态。

## 8. 注意事项

- 不修改冻结文件 `access-2026-11-15.json`、`video-inventory-2026-11-12.json`。
- 不提交持久目录中的 `runs/`、锁、退避状态或原始失败报告。可发布变更应按明确文件路径选择，避免把执行机状态打包进部署产物。
- 未核准城市、分店、POI、片段及截图的候选保持待核；增量抓取成功不等于发布审核通过。
