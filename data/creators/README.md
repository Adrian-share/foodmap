# 北京探店博主总名单

[beijing.csv](beijing.csv) 是账号总表，[beijing-samples.csv](beijing-samples.csv) 保存视频样例。两表均为 UTF-8 CSV，可在 GitHub 查看，也可导入表格软件或由程序读取。UID 和内部 ID 按文本导入，避免长 UID 被表格软件舍入。空单元格表示来源未提供，不能视为零或已确认不存在。

当前收录首批 3 位、候选 12 位，以及 1 个补充账号，共 16 条记录、13 个已提供的 UID 和 14 条样例视频。内部 ID 固定；改名、补 UID 或调整顺序时不重新编号。

## 来源与核验范围

来源为 FACT-10 附件[《北京探店博主候选》](sources/2026-11-11-beijing-candidates.md)，于 2026-11-11 整理入库。原文声明截至该日已通过 B 站视频元数据核对样例发布账号、UID 和发布日期，`source_verified` 及其日期记录的是这项来源声明。本次整理没有重新联网核验。

特厨隋坡、厨者王波、真探唐仁杰仅在原文开头被列为首批，缺少 UID、主页及样例，保留为 `pending_uid`，补齐后才能按 UID 使用。首批状态只表示已在选人范围内，不代表已采集完成。

「跟着老高吃东西」来自原文第 07 项，作为补充账号单独存放，通过 `related_creator_id` 关联「真探高文麒」。该关联表示来源中的推荐关系，不确认两个账号的身份或归属相同；统计候选人数时不能直接把 16 条记录当成 16 位独立博主。

样例标签保留原文的餐厅或内容线索，不是正式视频标题。样例不证明门店仍营业、分店地址已确认，或博主的全部视频均与北京有关。视频总量、到访分店、营业状态仍待选定账号后核对。原文末尾的《内容模块接口对齐》未随附件提供，仓库中暂不假定其接口。

## 总表字段

| 字段 | 含义 |
| --- | --- |
| `creator_id` | 稳定的内部记录 ID，同时供样例表关联；不表示已确认的自然人身份 |
| `name` | 来源中的博主或账号名称，保留大小写及末尾符号 |
| `platform` | 当前为 `bilibili` |
| `city` | 内容筛选目标城市，当前为北京，不表示账号常驻地 |
| `selection_status` | `first_batch` 首批、`candidate` 候选、`related_candidate` 补充账号 |
| `uid` | B 站 UID，文本类型；缺失时留空 |
| `profile_url` | 来源中的 B 站主页链接，缺失时留空 |
| `content_focus` | 来源描述的内容方向 |
| `selection_hint` | 原文选人建议：`nearby_coverage` 补附近门店覆盖，`professional_reviews` 专业点评方向；空值表示原文未特别推荐顺序 |
| `source_entry` | 原文编号 `01`—`12`；`intro` 表示开头提到的首批 |
| `verification_status` | `source_verified` 来源声明已核对账号及样例元数据；`pending_uid` 来源仅给出名称，账号待补 |
| `source_verified_at` | 来源声明的核对日期，ISO 日期；待补账号留空 |
| `related_creator_id` | 原文推荐关联的记录 ID，未关联时留空 |
| `notes` | 缺失信息或账号关系说明 |

## 样例字段

| 字段 | 含义 |
| --- | --- |
| `creator_id` | 对应总表中的记录 ID，每条视频只归到其来源对应账号 |
| `video_id` | B 站 BV 号，作为样例去重键 |
| `sample_label` | 原文链接标签，通常包含店名或分店线索 |
| `published_at` | 原文给出的发布日期，ISO 日期，不等于探店日期 |
| `video_url` | 原视频链接 |

同一账号的多条样例逐行保存；「台湾好A在北京」的多店样例仍为一条视频，后续确认门店后再拆分门店记录。

## 后续怎么用

原文建议补附近搜索覆盖时先看井盖小分队、船长觅食记、卡门姐Carmen，对应 `selection_hint=nearby_coverage`；偏好专业点评时先看真吃货老白、特厨魏味-、真探高文麒，对应 `selection_hint=professional_reviews`。这些是选人建议，不表示已批准采集。

Python 标准库即可读取。例如筛出附近覆盖方向的候选 UID，并取出对应的视频样例（从仓库根目录运行）：

```python
import csv
from pathlib import Path

root = Path("data/creators")
with (root / "beijing.csv").open(encoding="utf-8", newline="") as f:
    selected = {
        row["creator_id"]: row
        for row in csv.DictReader(f)
        if row["selection_status"] == "candidate"
        and row["selection_hint"] == "nearby_coverage"
        and row["uid"]
    }

with (root / "beijing-samples.csv").open(encoding="utf-8", newline="") as f:
    for sample in csv.DictReader(f):
        creator = selected.get(sample["creator_id"])
        if creator:
            print(creator["name"], creator["uid"], sample["video_url"])
```

选定账号后按 UID 盘点其北京视频，再记录原视频链接、分店线索和视频内时间点。总名单不代替后续视频批次或门店库。

## 维护规则

1. 更新账号前先按 `platform + uid` 去重；缺 UID 时人工核对名称与来源。补齐首批账号时更新原记录，不新增一条。
2. 新账号分配未使用过的 `creator_id`；不同 UID 保持不同记录，昵称相似或原文关联都不自动合并账号。
3. 新样例按 `video_id` 去重，并保证 `creator_id` 在总表存在。保留样例原始发布日期和原视频链接。
4. 每批新增或核验材料都在 `sources/` 留档，并在本说明记录对应记录 ID、来源文件和核验范围；只有实际获得核验依据时才更新核验状态及日期。
5. 两张 CSV 是结构化数据的维护入口。原始附件保留不改，后续更正写入总表、样例表及来源说明。
