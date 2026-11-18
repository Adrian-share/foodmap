# P3 完整游标观察候选

本候选仅补 P3 观察和隔离测试，不修改采集、队列、发布或预算逻辑。生产保持 `badb0f0d3d515444930d1bfceac32d5c865a4a9d`，23:55 唯一 wakeup 与 expected-release 不变；未安装本候选、未执行故障。安装和夜间预期版本变更须待 root 对精确提交复核。

`snapshot()` 在只读 SQLite 事务内保存每个 source_cursors key 对应的完整 JSON，字段为 `cursor_values`；另存 UTC `checked_at` 和同一数据库快照中的 `last_scan`。包含页码、来源绑定、last_success、next_retry_at、failures、错误分类及未预先枚举的扩展字段。原 `cursors` 键列表继续保留，只证明键集合。

观察 journal 保留以下独立时间点，不回填或改写原 badb 证据：

- `baseline`：首个 Pi 信号前最后一次通过保护检查的实际快照，不使用更早的 tick 快照。
- `second_snapshot`：Python 信号前实际快照。
- `recovery_snapshot`：原 Pi EOF 退出、launchd 恢复并通过原进程检查后的实际快照。
- `final_snapshot`：任务终态时实际快照，先持久化再检查 settled，即使结算验收失败也保留。

`cursor_recovery_comparison` 和 `cursor_final_comparison` 保存前后 checked_at、unchanged/changed/missing/added；changed 含原值与新值，按规范化 JSON 比较。完整值缺失记 `missing_cursor_snapshot`，键丢失记 `missing_cursor_values`。同键值变化或新增键记 `pending_source_progress_review`，不自动判成功、丢失或合法推进。root 必须结合两端完整值、last_scan、来源逐页成功/拒绝回执与时间独立核对；最后一次扫描摘要本身不能证明区间内所有推进。原 `cursor_keys_preserved` 保留为单独的键检查，不代表完整值恢复。P3 总结仍待 root 复核。

测试仅使用临时 Store、模拟进程检查和 mock signal，不读取生产库、不发真实信号或请求模型。先保存旧实现缺 `cursor_values`/恢复快照的 RED 日志，再实现；另测同键清空、自然推进待核、旧 key-only 证据不足、首个信号前落盘与恢复后落盘、结算失败仍保留值。命令和日志位于本轮附件中的 `evidence/FACT-33/p3-cursor-values-20261118/`。

源码回归不能代替 P3 现场。R4 新内容 60 秒、每日 09:00 来源周期与北京内容完整覆盖仍未通过；三个完整合集不等于 19 个账号投稿列表均可用，13:16 来源退避重试不替代次日每日周期。唐仁杰旧视频简介只有 BGM 的 metadata 不构成新店分店核准证据。

## 两次信号前的登记表补证

后续候选在 interrupt 的 fresh 检查时取得实际 `fresh_registration`，保存为第一／第二次 `first_registration`、`second_registration`，均在对应 mock/实际 signal 前写入 journal。首份不再使用调用者较早的登记表。最终分别核对两份 metadata descriptor 与各自全部 frame_files；第二次故障前新增原帧必须保留。缺任一登记表不能通过；最终实际登记表与四个分项检查也先持久化，失败仍可审查。原保护和 expected-release 校验实际生产 badb 的语义不变。

本轮 RED 为首份仍旧、第二份缺失以及双份最终核对未实现；随后专项 10 项／完整 Python 63 项通过。均为隔离测试，不是生产故障。观察器候选可独立审阅，无需为记录字段重启采集服务；固定候选目录与夜间实际命令仍待 root 复核，不自动改 wakeup 或安装。
