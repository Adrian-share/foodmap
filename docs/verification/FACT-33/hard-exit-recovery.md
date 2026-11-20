# P3 硬退出恢复候选

当前唯一生产 release 为 c4520c237f940b9be2324dba3ffa6d0070f71d0a，实际 GitHub 名单为 feebf495715a843dc1d3f9c5285adf67313fa077，已由自然轮询激活 revision3 并真实发现124个新BV。生产共19UID/217BV/202jobs，公开仍16店/generation2。本文所述后续修复尚未安装，不改变本次已完成升级。

root 的隔离实验确认：工具注册后 Python 硬退出，finally 不会执行；全局 pi/task.json 有 metadata，但下次 bind 会覆盖登记表。原有 TimeoutError 捕获恢复和空闲重启不能证明完整 P3。

先运行 `tools/venv/bin/python -m unittest discover -s tests/agent -p test_hard_exit_cache.py -v`，旧实现实测失败于重试 context 缺 metadata。隔离子进程领取真实 SQLite fixture 任务，使用实际 Node register 写 source JSON 后 os._exit(73)；没有模型调用或生产库写入。

修复仅在固定任务目录原子保存 registered-context.json，每次 register 及工具完成时更新并 fsync 文件。登记表不含 prompt、提案、模型配置、会话控制或发布凭据。原帧字节及登记 source JSON 仍按 SHA 存放；不保存视频/音轨/分片。

Service 在覆盖全局 Pi task.json 前读取对应任务登记表，验证 task/UID/BV/P/root、文件范围、symlink、大小和实际 SHA，以及 metadata 作者/页和帧 CID。只合并 evidence/frame_files/总预览预算；本次 discovery 继续绑定最新 SQLite 写出的文件，旧 prompt 不恢复。累计尝试、日预算、会话、游标和已提交回执不重建。

绿测试覆盖：实际 os._exit 后 metadata/fixture PNG/预算恢复；同一任务累计尝试1→2、会话/游标/committed回执保留；重试间发现信息变化仍匹配 discovery 哈希；五个身份字段、错作者、坏 SHA、source/登记表 symlink 被拒，额外控制字段不恢复。它是无模型的隔离测试，不能计作生产 P3 通过。

P3 保持 partial。真正 Pi 任务中先终止 Pi 再终止 Python的联调，须在后续原预算内进行并核对租约/已提交回执/业务只完成一次。今天10次已用完，不重置或新建伪任务。候选经 root 复核后沿用既有唯一 production 升级步骤，保护最新217BV状态；不能恢复到93BV备份。R1实际内容回退、R4首个可搜请求≤60秒、每日09:00自然来源周期与北京内容清理仍未完成。
