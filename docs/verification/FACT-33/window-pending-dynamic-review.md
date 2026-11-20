# FACT-33：日期窗口、确定性待核和动态公开合集候选

本轮只交源码与证据，等待 root 对最终精确 SHA 复核。生产仍为 badb0f0，唯一 label/state/模型/固定 SSH 权限不变；没有安装、归位运行记录、更新 GitHub 名单、执行故障、调整 wakeup 或部署 Sites。

## 三类变更

1. P3 观察器增加显式 `--window-start/--window-end`，必须有时区、正序、时长不超过两小时。CLI 按窗口开始的上海日期生成 `acceptance/p3-YYYYMMDD/status.json`。同一 journal 的 release/窗口不一致拒绝读取为新任务，旧原件不删除。每次信号前再次确认真实时钟仍在窗口内；既有身份、daemon/PID/PGID/单例、prepared、会话、登记表、EOF、日预算/总尝试保护不变。旧11月19日窗口不再用于新验收。
2. `pending-review-v1` 只决定等待还是按旧退避重试，绝不核准或发布。只有正常 settled、固定工具访问无错误、实际机器核验仍缺 branch/poi、metadata BV/UID/P/CID 匹配、来源 URL 合法、原 JSON/原帧字节 SHA 匹配、真实 POI 响应成功，才考虑稳定待核。初始规则覆盖：简介为空/“-”，且已登记字幕/高置信原帧 OCR 不含街道或具体地址；或官方简介绑定的同街同品牌有多个高德分店。这里指已有证据不足，不能推断整个视频没有门店线索。非空描述的其他疑难、缺工具结果审计、抓帧/地图/来源错误继续原退避；model/Timeout 异常仍走原服务分支。failed attempt3 不变。
3. 可信 GitHub `sources[]` 可附加 `collection_anchors: [{season_id,bvid}]`，每个 season_id 必须已在同账号 `season_ids` 内，禁止重复/额外字段/URL 注入。未提供时继续用原静态三项回退，普通 season_ids 接口和单视频保持。Scanner 每次从已成功注册的名单规划，不依赖重启来读取新锚点。Node 仅能请求固定官方 view，完整检查 BV、UID、season/mid、每集作者、ep_count、唯一 BV、页数与哈希；取消静态三个 BV 的硬编码许可，并未增加任意 URL 权限。

名单损坏保留最后有效注册版本。作者冲突/来源拒绝不入队、不清空历史列表、原 cursor page/last_success；只更新现有错误和退避。禁用账号/移除合集停止新采集，不删除历史。已合法注册但上游受限的新来源保持受限，不将它称为有效空目录。

## 已有任务的只读归类

2026-11-20 10:19 上海读取202条任务。真实未公开 attempt2 是8条，另1条 attempt2 是已公开曲廊院；并不是10条均可归位。8条均正常 settled，原帧总40张；固定工具结果未见来源/地图/抓帧错误。四季民福、京华楼的 proposal 写了 source_access，但会话没有对应机器工具错误，不能仅凭模型词语分类。

| BV | 门店线索 | 原帧数 | 登记POI数 | dry-run |
| --- | --- | ---: | ---: | --- |
| BV1vpBGYcEM8 | 四季民福 | 4 | 20 | pending，next_retry_at=0 |
| BV1LmquYpEiQ | 净香居 | 3 | 15 | 同上 |
| BV1nqqnYfEuc | 京华楼 | 6 | 20 | 同上 |
| BV1SHz2YQEuS | 白记四益轩 | 6 | 2 | 同上 |
| BV13ozdYSEvw | 松鹤楼 | 3 | 8 | 同上 |
| BV1AvzvY5EzN | 南京大排档 | 6 | 16 | 同上 |
| BV1mCBUYHEKm | 柳州肥姨妈 | 6 | 20 | 同上 |
| BV1kgBxY1EiW | 荣小馆 | 6 | 5 | 同上 |

正式状态仍196 deferred_budget/3 failed/2 pending/1 published，217BV/202jobs。dry-run其余194条 unchanged。CLI `scripts/pending-review.py` 仅只读，输出每行 job hash、完整证据指纹、会话SHA、机器核验与拟变更；没有 apply 参数，不写 SQLite。对旧提取结果的工具成功证据来自绑定会话中的实际 toolResult，并非补写空审计。新运行结果由 RPC 保存本次固定工具错误代码。

root 批准归位后：先排空唯一服务、确认无租约/prepared，备份最新同一 SQLite/登记证据/会话/回执/预算/游标；复核每行 CAS job hash、最新提取结果及证据字节仍匹配，再在单事务仅改这8行 stage/next_retry_at 并保存所用机器策略。不得改 attempts、model 计数、会话、proposal、回执、公开 history、flag 或失败次数。随后恢复同一 label 并比较保护表/心跳。此步骤本轮未执行。新证据须有可追溯的新哈希，先进行受控确定性重核；同证据无自动重领，新增 discovery 来源/标题也不自动花模型预算。

## 新来源真实证据与隔离范围

11月20日10:22:59上海，现有身份/网络上仅发两次官方匿名 view 请求：

| UID | season / anchor | HTTP / code | 完整集数 / 作者 |
| --- | --- | --- | --- |
| 613814196 | 4350986 / BV1ytEE6rE2s | 200 / 0 | 175/175，全部613814196 |
| 12613385 | 92362 / BV1ZF411x7Wo | 200 / 0 | 32/32，全部12613385 |

每个原响应各冻结一次。175按100+75、32按32分页验证来自该真实原件的离线重放，不是第三次 HTTP 请求。源响应及列表 SHA 在附件 `public-anchors-live.json`。没有重新探测19投稿/WBI、Cookie或新凭据。

`proposed-watchlist.json` 是未推送草案：保留19UID、原三合集和所有单视频，给已有两个enabled账号增加上述season，并为五个合集配置动态锚点。隔离库复制217BV/202jobs/原attempts，只重放这两份真实列表：3页成功，库外205BV（207中2个已知），原217和202行完全保留；再跑2来源均退避、0请求、0新增。模拟 registry4 不是真实远程注册回执；205不是生产新增、更不是新店。生产名单仍 feebf495 / revision3。

## 部署依赖和回退（本轮不执行）

- 观察器可以固定候选目录独立执行，expected-release 仍指实际审阅过的生产 badb；不需仅为观察字段重启生产。
- 待核策略/动态来源属于采集业务，root 批准最终 SHA 后才按既有停服、一致备份、同label/state安装、真实committed心跳验证顺序升级；保护最新217库和当日10次、总3次，不用隔离库覆盖运行库。失败先停新程序，再用badb代码+最新库恢复，旧Autopilot保持paused。
- 动态名单的新字段同时需要云端 `watchlist.cjs` 与生成的协议校验器兼容。root 独占 Sites，先审阅/部署同SHA的云端兼容候选，再确认唯一生产已支持，然后才可CAS更新实际集成分支名单；之后等默认900秒自然激活。没有本轮 GitHub / registry / 云端实际激活证据。
- 当前不再重复R1 CAS：root实际16→15→16及独立Sender丢回执恢复已通过，generation6保持。新内容R4<=60秒、真实P3和北京完整内容均未通过。11月19/20自然09:00确实运行；三合集与单BV可访问，19 posts仍退避，不是全账号投稿覆盖通过。

## 精确复测与窗口启动

源码冻结后的SHA、包SHA、命令退出码见附件 manifest；源码候选在PR #8，base `fact-18/beijing-content-003`。源码回归与生产验收分开记录，mock/隔离数据不进入通过的真实业务门槛。

干净审查 worktree 中执行已有安装器（只安装该目录的锁定工具，不加载launchd）：

```sh
/usr/local/bin/python3 deployment/foodmap-agent/install.py
tools/venv/bin/python -m pip check
tools/node-v22.23.5-darwin-arm64/bin/node tools/node-v22.23.5-darwin-arm64/bin/npm ls --all
tools/node-v22.23.5-darwin-arm64/bin/node tools/node-v22.23.5-darwin-arm64/bin/npm ls --all --prefix agent/pi
tools/venv/bin/python -m unittest discover -s tests/agent -v
tools/node-v22.23.5-darwin-arm64/bin/node --test tests/dynamic-source-anchor.test.cjs tests/source-anchor.test.cjs tests/source-page.test.cjs tests/watchlist-registry.test.cjs
tools/node-v22.23.5-darwin-arm64/bin/node tools/node-v22.23.5-darwin-arm64/bin/npm run test:publication
```

npm两处均使用完整 lockfile 的 `ci --ignore-scripts`，不逐包软链。Python>=3.12、Node22.23.5、Pi1.5.2及依赖锁在仓库。没有模型/上传/Sites写凭据的审查环境同样可以完成这些离线测试。首次红日志中Node审查缺依赖的结果不算规则红；补齐依赖后在97ca隔离原源码上重放新测试，明确因 invalid_watchlist_schema/unapproved_collection_anchor 两项失败，再记录绿。

**root复核后才能使用**候选目录内观察器，不是现在已启动的命令；固定候选目录绝不随HEAD改写。使用其审查通过的最终SHA替换`<候选SHA>`：

```sh
/Users/adrian/foodmap-agent-runtime/foodmap/preview/releases/badb0f0d3d515444930d1bfceac32d5c865a4a9d/tools/venv/bin/python /Users/adrian/multica_workspaces/adrian-fact-1564e6a84c5b/fact-33-15825455c4b5/workdir/candidates/p3-<候选SHA>/scripts/p3-acceptance.py --arm --expected-release badb0f0d3d515444930d1bfceac32d5c865a4a9d --multica-cli "$MULTICA_CLI_PATH" --window-start 2026-11-21T00:00:00+08:00 --window-end 2026-11-21T02:00:00+08:00
```

实际运行版本若经root批准升级，先重新核对其PID/唯一label/五工具映射，再使用该实际SHA作为expected-release；不能把观察器SHA当运行程序SHA。本轮唯一wakeup保持disabled。待root批准才将同ID前移11月20日23:55，仍以新鲜合法Multica任务身份在前台跑一次，不存token、不借profile、不新增observer/collector/Pi或重复wakeup。若没有attempt1且metadata/帧已登记、used<=7的候选，发送0信号并保持pending。

补充回归事实：依赖完整安装后的一次Python80项发现旧隔离进程组fixture的marker存在但字节尚未写完（JSONDecodeError）。只把该测试fixture的生产者改为`.tmp`写完再rename，业务close/信号代码未改；失败原日志保留，确切隔离测试进程组已核验daemon PID后清理。随后Python80全通过、无skip；Node来源/名单/公开协议合计60通过。源码测试不是P3生产信号记录。
