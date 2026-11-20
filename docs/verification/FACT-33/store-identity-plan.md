# 同店多视频：版本化复用store_aliases

本候选仅研究/源码/隔离验证，不安装生产、写运行库、部署Sites或调整夜间wakeup。现生产b745；身份对应与C2是两种证据，禁止用映射代替到访核准。

| 已确认事实 | 源码/红证据 | 最小改动 |
| --- | --- | --- |
| 原十店无POI，catalogData只比ID或POI | data/catalog.json、nearby.cjs；root隔离反例同分店2点 | 复用POI→beijing-N store_aliases；不按名字/距离自动合并 |
| catalog接受别名，公开record却保留源store_id | state.cjs；red-identity.tap首条actual amap:OFFLINE_TAIFENG vs beijing-1 | 在新内容版本中同时投影record/visit/catalog/ledger；C2原件不改 |
| manifest不接受身份字段 | red-identity.tap invalid_manifest | 仅增加可选store_aliases与store_alias_evidence，沿用blob/stage/commit |
| 旧发布者不会回传新字段 | publisher.py、read-model.cjs | 缺字段继承不可变parent身份；无有身份的祖先才使用冻结基线默认 |
| MCP再次合并本地静态基准 | nearby.cjs、createRemoteReadModel | 新快照携带完整北京目录标志，MCP/网页读同一投影，不以本地别名改远端版本 |
| 当前完整POI接口省略type/typecode | 10次实际同源查询原件 | 可用字段只能证明名称/分店地址/坐标；母点/坐标冲突保持待核，不编造分类证据 |

扩展manifest两个相邻可选字段：store_aliases仍为原POI→旧ID字符串map；store_alias_evidence逐条携带poi_id/store_id、旧行canonical SHA、真实原响应base64/SHA、查询时间、去凭据来源URL与实际同源读取URL。完整映射只指向已验收的原北京店，双向唯一、无链/环；身份证据在manifest哈希内，不改变verification_ids/原C2 JSON/截图SHA。

读取/暂存从该manifest及其parent_version解析身份，绝不读取current当成旧版本的身份来源。旧发布者省略字段继承父身份；新发布者原样带入父身份，显式更新创建新manifest/version。空map可显式撤销，但已有记录如果因此成为潜在旧店重复，必须重新核对。旧manifest原字节/旧data_version不变。身份变化不通过改config.json或重建冻结baseline发布。

新版本读取时：从冻结baseline_records构建原十店的版本内目录，加上批准的原批次/动态记录，所有store/visit/record/ledger引用使用同一canonical ID，旧visit_id/详情URL保留。新快照catalog标记为完整北京读模型；nearby/MCP不再把本机原十店重复加回。旧格式快照维持现有兼容读法；fixture数据集不变。

暂存仍先重跑C2并比较原始record/verification SHA，再独立验证身份原响应/旧行SHA/唯一具体分店。未知旧店对应只标记潜在重复待核并拒绝该发布，不把它计成新店；这只是等待明确对应，后续有合法映射即可经同一发布器收录到访。已明确POI的同品牌其他分店不合并；名字/坐标只用于风险提示/否决，不授予合并关系。

真实材料和代码fixture分开：十个原店各一次现有公开同源POI查询，没有读取服务端key或新Cookie。输出真实候选和具体排除/冲突理由；只给root审阅，不写入真实映射配置。十家各有一个名称、带门牌地址、行政区和原坐标一致的具体分店候选；砂锅居三份旧基准纬度均39.920459，与POI约1米，早期570米判断已纠正。十家仍全部为requires_root_review，不写生产对应表。排除酒店母点、停车场、出入口及其他地址，现有代理省略type/typecode与上游total这一限制明确保留。

全链路隔离验收将覆盖同店双BV、不同POI分店、博主筛选、旧详情、图片/描述归属、分页/首页/目录/真实本地MCP HTTP、版本回退、旧发布者继承和Worker禁动态代码生成。回退只选择旧内容版本及其身份快照，不重写旧材料。实际R1/P3/R4均不在本候选测试中重做或标过。

## 接口与兼容边界

- `store_aliases` / `store_alias_evidence` 同时缺省：旧快照不变；旧发布者在新父版本之后省略时继承父版本不可变身份。只传一项拒绝。显式空对象+空数组代表撤销，但不能使现有到访成为旧店潜在重复。
- 证据数组逐条验证旧行canonical SHA、原响应SHA、北京具体分店/门牌/行政区、排除母点、双向唯一。名称和100米内距离只是证据一致性/冲突否决条件，**不会自动生成别名**；alias输入须先人工核准。无关系时只保存`store_identity_unresolved`，不删除旧店，不把该到访当净增。
- 扩展仅限十个缺POI的旧ID；另外六家已有明确POI，仍按原POI去重。不同POI不能因同品牌/近坐标合并。
- `createContentState`在核验之后创建投影副本，`catalog.complete=true`是完整北京目录；raw C2及旧manifest/图像/visit_id原件不变。`read-model`、`nearby`、首页、详情、ledger、MCP均使用同一投影。新manifest包含身份原响应，因此身份变更本身生成新data_version。
- `Publisher.publish(..., store_aliases=..., store_alias_evidence=...)`沿用当前固定发布器/SSH/blob/stage/commit，不新增入口、工具、token或调度器。核准映射可由现有唯一owner携带为一次内容版本；日常发布继承。未知对应在冻结上传计划前退出，保留已通过的C2和待核原因；新身份版本提交后，`Service.advance_pipeline`仅以原核验材料确定性重试，无Pi领取、attempt/模型计费。相同父版本不循环重领。
- `find_nearby_food`增加可选`creator`，默认行为不变；按博主返回同店该博主自己的BV/截图/描述。未增加Pi五工具。地图首次请求识别URL的data_version，目录回链也固定版本；不让旧详情跳到current身份。

## 验证范围与回退

新增Node隔离用例检查16→16门店、16→18BV/到访、两博主各自卡片、同品牌不同POI、未知/母点待核、原C2字节不变、旧字段继承、坏哈希与矛盾映射拒绝、内存CAS回退/恢复/重放、图像SHA及Worker禁eval/wasm。Playwright在临时loopback端口运行实际页面，SDK和播放器响应明确fixture，检查地图点、分页6→12、目录/详情/BV/截图/描述与版本；**不声称真实播放器推进或R4通过**。真实本地MCP HTTP另测tool discovery/call，不占用现有8767或启动Pi。

仅在root复核精确SHA后才讨论安装；本轮生产、运行库、名单、Sites与wakeup均不写。未来接入顺序为先兼容读取端，再精确发布者，最后人工核准身份内容；旧发布者可以省略字段保留身份。回退数据使用同一`release.rollback`和当前parent/etag CAS恢复已冻结目标，身份/记录/图片随版本回退，禁止删除blobs或改历史。代码回退到不识别新manifest字段的b745前，先将pointer切回无新字段旧版本；不能让旧schema读取新manifest。该操作本轮只隔离验证，不执行真实R1。

原基准/compiled/public-assets、独立C2规则/旧核准文档与截图未编辑。真实POI候选包与fixtures分离，候选未核准、未发布；P3/R4/完整北京补全保持待验。

## 3ca2a3a之后的边界修正（仍仅候选）

root的两个纯离线反例已在跨C2/暂存测试中复现：C2 v2已核准的通州分店被旧映射阻塞；前缀相似的快餐二店却能绑定旧泰丰楼。`red-cross-stage.tap`分别为`store_identity_pending`与`Missing expected rejection`，5项中2失败/3通过。原3ca2a3a提交和交付原件保持冻结，本轮另出提交。

- **明确不同分店不等待无关旧店映射**：仅在既有C2独立核验通过后，对具体分店名、不同街道/门牌和明确分离点位的记录消除旧店重名风险。没有街道、分店名仍等于品牌、仍指向旧分店名称/地址或点位近旧店的关系不明确记录继续pending。该判断不产生别名、不批准C2，也不依据标题/模型置信度。
- **同店映射不再使用startsWith授予名称关系**：名称主体须相等；基准有明确括号分店时分店也相等，基准只有品牌时可选括号分店标签必须对应旧具体地址。`泰丰楼快餐二店`即使同址同点也不等于`泰丰楼`，需独立核对，不能形成净增或自动合并。名称、地址、距离仍只是映射证据的一致性/冲突检查；没有人工核准的alias输入不会自动生成对应。
- **母点否决绑定原C2证据**：stage复用已校验哈希且重跑C2的原输入，按该record的POI ID取回原POI名称/type/typecode，文化/酒店/商场/停车等母点或非餐饮类别继续拒绝。Python预检向同一固定Node检查器传递已有核验文档，使用同样规则，避免先冻结无法发布的计划；不新增HTTP、目录权限、模型工具或发布路径。没有类别字段时不编造分类，真实物料仍交root核准。
- 原“不同POI”fixture已改成真实不同的**模拟**分店：通州店、通州区滨河路52号、116.65/39.91，三项均不同于前门旧店，且经未改动的C2 v2生成核准文档；不再只换POI ID。另测篡改已核准record仍在stage因`verification_failed`被拒绝。

协议字段、版本/旧发布者继承、记录投影、分页及MCP读取方式相对3ca2a3a不变；本轮只修身份边界和对应fixture/回归。原C2 engine、schema、素材与旧版本不编辑。十条03:35–03:36真实同源POI原件仅做离线重检，原SHA不变；新绑定核准0条、待root核准10条，原六家已公开POI与C2关系不改，不把文化或酒店母点计为餐厅。

生产继续b745，名单自然推进到716BV/701jobs是现有唯一服务所为，不回写旧422库。Sites/日10/总3和今晚23:55的原wakeup/expected-release=b745不变；本候选不安装、不发布。P3、R4和北京内容补全不因本轮隔离测试通过。
