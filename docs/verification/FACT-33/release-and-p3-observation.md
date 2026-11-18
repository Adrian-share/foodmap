# R1 / R4 / P3 后续验收候选

生产当前43b2eb0676dfd2a797fc7d0a9b6e3cb440370794，唯一 `com.adrian.foodmap-agent`，Python32674/Pi32682；217BV/202jobs/revision3，名单feebf495715a843dc1d3f9c5285adf67313fa077。今天10次业务尝试和model_requests74未重置。本候选的公开观测接入尚未安装；保持43b直到root复核。Sites不变。

## R1：root已完成公开回退与恢复，不再执行本轮CAS

`scripts/release-roundtrip.py preflight --journal evidence/FACT-33/r1-roundtrip-20261118` 已真实读取同一运行库的manifest历史并复算两版SHA，检查固定公开接口的JSON/目录和16/15店版本的16/15张图片。root独立对16张去重图复核200/哈希。此步骤不读取上传配置，不POST，不改运行库、pointer或blobs。

已冻结版本：

- 当前16店：`v1-cb050932cc0417bdfdcd4c7d3b908f0c3e47949223414c3f2e9b7fe2fb669452`，generation2，ETag `065dfbac235edcd7b98ffc912b0b1904`。
- 旧15店：`v1-c8579269161c0ed32733da46f9c59929656ef9ac5669ac9e16390c5a194ea602`。

root于2026-11-18实际完成16→15→16，generation2→3→4，JSON/图片检查passed，重复请求没有新增generation，未写生产SQLite。证据为 `evidence/FACT-33/r1-roundtrip-20261118/root-actual-roundtrip.json`。恢复回执 `bb9fbc6f-3d01-5928-ba2a-0f918980076f`，该场景结束ETag `196822893b84466013aeb4186568aebe`。以上表格是执行前冻结值；后续root实际投递组件子case可能继续推进generation，须独立读回，不把这个ETag当永久当前。不要再次发送原两次CAS。

两个方向使用现有固定SSH的 `release.rollback`。第一次以原16店/ETag作CAS预期；恢复冻结第一次committed回执和真实current读回的15店/新ETag，不套用旧manifest的parent去release.commit。请求ID由plan_id+步骤确定，第一次和重试经Publisher.canonical边界；同时保存规范化wire字节、fingerprint与只读审阅JSON。prepared断线只在原parent/ETag未变时用同ID/同body继续；rejected/版本变化拒绝。committed重放只查回执，不再POST。

回执在任何公开读回/图片验证前落journal；若回执确认而公开读回失败，重跑rollback只reconcile该请求，再restore。验证失败不丢恢复CAS需要的父版本和ETag。按原指令保留完整旧/新JSON、图片与目录验证；任何缺口不能记作R1完成。不删除blobs、不修改生产publication history、不以旧SQLite覆盖217BV。执行保护：无租约/处理中/暂存/未确认写回执，且当天自然业务预算已耗尽，避免竞争发布；其他窗口先由root审阅排空方案。

## R4：绑定下一条真实内容发布，不复用恢复旧16店作通过

候选通过生产CLI显式注入PublicationAudit；直接构造Service/Publisher的fixture默认没有正式站读者，测试注入固定响应。发布器在release.commit前保存旧公开snapshot/visit集合、目标和本地时间；committed后立即按固定公开域连续查询current、未固定版本的content与nearby。记录每次请求区间、错误状态、首次新版本可搜响应、服务回执和pointer时间，以二者较早时间保守计算60秒门槛。

保存公开响应、图像200/SHA、同域详情和对应BV/P。403/404保留为错误，不能当空目录。图片/详情错误仍保持pending。已有版本重放、空初始化或rollback_restore不满足“新visit”条件；旧回执时间早于probe准备时间、transition_id不属于本次回执也不能算新内容R4。探测失败不能撤回或阻断已committed发布/回执恢复，异常单独保存。当前实现只覆盖正常回执返回后连续读回，未跨越丢回执/进程硬退出的观测缺口，不声称覆盖该区间。指标不会直接改验收台账；真实新内容及浏览器播放器时间推进仍须root同版复核。旧63.482秒晚读的R4保持pending。

## P3：已有任务、原预算内、一次条件故障

使用 `scripts/p3-acceptance.py`，只读运行SQLite、已登记证据、会话与进程信息，及合法本轮Multica CLI保护检查。它不创建任务、不取来源、不调用模型/发布、不改时钟/任何调度flag/lease/attempt/预算。测试中signal不执行，真实故障未发生。

1. 2026-11-19 00:00–02:00（上海）窗口。等待唯一production里实际正在cleaning的attempt1任务；须已注册metadata和原帧、登记文件在本次尝试后更新、全局Pi绑定该任务、无已提交提案，且当天已用次数≤7。初选attempt2任务拒绝，不能对两条旧高尝试视频注入。标题/简介均不构成核准；四季民福简介“-”仍按C2待核。
2. 临信号再复读DB和进程：旧Autopilot paused/旧tasks终态、无prepared写回执、Singleton/Python/launchd/实际Node映射/父子关系/PGID与五工具一致，PID不等于Multica daemon或observer。先向该Pi独立进程组SIGTERM；登记动作后不重复。
3. 等同一任务自然重试到attempt2、同session、重新登记证据、当天已用≤8时，再仅对原production Python发SIGKILL。并非对另一条原本attempt2的任务故障。Observer从不启动服务，由原launchd恢复。原Pi必须经stdin EOF退出；超过15秒则只清理已核验的原Pi组并判失败，防止孤儿，不记通过。
4. 等新Python/Pi健康和原租约自然到期，原任务自然attempt3结算；不直接回收租约。核对同session/path、原metadata/帧SHA、历史游标键/manifest/已提交回执和全部旧attempt仍保留，日次数≤10、唯一业务任务、一次业务终态事件及non-aborted settled。pending是合法业务结果，不伪造核准。观察结果仍须root复核，不自动改P3绿。
5. 预算提前用满、任务不满足、身份/版本变化、恢复失败或窗口结束都停在pending/failed，保留journal，不补次数、不重复故障。状态在 `python-preview/acceptance/p3-20261119/status.json`，只读预检和PID保护已实际通过，未发信号。

## 提前armed与任务身份

Multica拒绝去掉task身份的API调用；不保存当前task token，不改CWD绕过marker，不借用用户profile。用现有唯一wakeup前移到2026-11-18 23:55 Shanghai；该轮开始先将**同一ID**重设明日09:15，然后以前台、该轮合法任务身份运行：

```sh
tools/venv/bin/python scripts/p3-acceptance.py --arm --expected-release 43b2eb0676dfd2a797fc7d0a9b6e3cb440370794 --multica-cli "$MULTICA_CLI_PATH"
```

若root此前已复核升级其他精确release，先读指令和实际程序确认后使用该SHA；没有明确匹配就停在pending。必须前台收完结果，不能nohup/后台退出；每次等待≤60秒并检查journal。停止该observer仅终止其明确PID，先比对Multica daemon PID；不停止production。没有第二个collector/Pi、常驻observer或重复wakeup。09:15任务只读复核每日09:00来源周期、队列、回执、P3 journal和公开版本。当前13:16是既有游标退避重试，名单触发扫描不能替代每日门槛。
