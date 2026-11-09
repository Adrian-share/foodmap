# FACT-5：已验收成果入库

本次将用户已确认验收的北京探店 MCP 实现、验证过程和最终结果完整保存进仓库。
项目代码从已交付的 `FACT-5-beijing-food-map-mcp-images.zip` 解出，82 个文件逐字节匹配，没有重写历史测试或对话记录。
文件 SHA-256、大小及原交付包哈希见 [accepted-delivery-manifest.json](accepted-delivery-manifest.json)。

## 交付行为

用户明确提供王府井、东坝或大钟寺后，`find_nearby_food` 解析为对应地铁站的固定 GCJ-02 样本坐标，
用 Haversine 公式计算到十家样本门店的近似直线距离，升序取三家。
每家结果包含完整名称、分店地址、米制距离、探店出处、原视频链接及一张原探店视频的真实封面。
结构化 JSON、Markdown 图文和标准 MCP JPEG 图片内容块同时保留。

用户只问“我附近有什么？”时，首轮先追问地点，不猜测位置、不搜索、不推荐门店或图片；
同会话补充“东坝”后才调用工具返回结果。未知地点明确返回 `location_not_found`，不沿用旧起点。

## 验证过程

| 阶段 | 实际结果 | 记录 |
| --- | --- | --- |
| 原地图原型基线 | 7 项通过 | [01-prototype-baseline.tap](../beijing-food-map-mcp/evidence/01-prototype-baseline.tap) |
| 先写 MCP 协议验收测试 | 实现前 15 项全部失败 | [02-mcp-red.tap](../beijing-food-map-mcp/evidence/02-mcp-red.tap) |
| 初次实现 | 14/15 通过；参数错误断言需对应 SDK 的 `isError` 表示方式 | [03-mcp-intermediate.tap](../beijing-food-map-mcp/evidence/03-mcp-intermediate.tap) |
| 首版实现完成 | 7 项原型＋15 项协议，共 22 项通过 | [04-all-green.tap](../beijing-food-map-mcp/evidence/04-all-green.tap) |
| 首版 Codex 客户端 | 四个真实会话用例通过 | [首版 summary](../beijing-food-map-mcp/evidence/codex/summary.json) |
| 先写图片增强测试 | 6 项中 5 失败、1 通过 | [01-images-red.tap](../beijing-food-map-mcp/evidence/images/01-images-red.tap) |
| 图片增强完成 | 原型、协议及图片，共 28 项通过 | [02-images-green.tap](../beijing-food-map-mcp/evidence/images/02-images-green.tap) |
| 图片版 Codex 客户端 | 四个用例重新通过；成功调用均收到 3 个 JPEG 并输出 3 张 Markdown 图片 | [图片版 summary](../beijing-food-map-mcp/evidence/codex-images/summary.json) |

协议测试通过官方 SDK 连接真实 Streamable HTTP 服务，验证初始化、工具发现及调用，
包括别名、空白位置、未知地点、并发隔离、只读边界、图片 MIME 类型和 SHA-256。
完整请求和响应保存在 [首版协议记录](../beijing-food-map-mcp/evidence/05-protocol-exchanges.json)及
[图片版协议记录](../beijing-food-map-mcp/evidence/images/03-protocol-exchanges.json)。

历史报告按原交付保留：

- [VALIDATION.md](../beijing-food-map-mcp/VALIDATION.md)：首版实现和客户端验证。
- [IMAGE-VALIDATION.md](../beijing-food-map-mcp/IMAGE-VALIDATION.md)：图片来源、图片增强及客户端验证。

## Codex 的四个实际用例

| 用户问题 | 核对结果 |
| --- | --- |
| 我在王府井，附近有哪些探店餐厅？ | 王府井地铁站；富春居 1.72 km、泰丰楼 1.92 km、北京宜宾招待所·餐厅 2.82 km |
| 我现在住东坝，找三家最近的探店餐厅。 | 东坝地铁站；寂川 8.11 km、潇湘阁 8.81 km、老吉堂·吉来 8.93 km |
| 大钟寺附近有哪些探店餐厅？ | 大钟寺地铁站；洪福亮酒家 3.74 km、砂锅居 5.68 km、同和居 5.85 km |
| 无地点新会话：“我附近有什么？”→ 同会话补“东坝” | 首轮工具调用 0、地点解析 0；第二轮才查询并返回东坝三家及图片 |

四个用例使用四个不同会话，缺位置两轮使用同一会话 ID。每轮的用户问题、命令、时间、实际工具参数、
模型回复、原始 JSONL 及服务端解析事件都保留在 [codex-images](../beijing-food-map-mcp/evidence/codex-images/)。
图片版脚本还对 Codex 返回事件中的三张 JPEG 解码核对哈希，确认图片与门店顺序一一对应。

历史对话中的回环图片 URL 对应已经关闭的临时验收服务。直接看最终结果请下载
[自包含 HTML](../beijing-food-map-mcp/evidence/images/images-preview.html)或查看
[预览截图](../beijing-food-map-mcp/evidence/images/images-preview.png)，无需重新启动服务。
这些是实际工具结果生成的展示预览，并非 Codex 图形客户端截图。

## 原始数据和图片

附件提供的七个原始文件保持不变，包括 `TASK.md`、`MCP-ATDD.md`、`samples.js` 及网页原型。
校验见 [input-integrity.json](../beijing-food-map-mcp/evidence/input-integrity.json)。
十张真实封面来自十家店原样本所列 B 站视频，记录了视频 ID、标题、图片来源、获取时间和哈希，
详见 [图片 manifest](../beijing-food-map-mcp/assets/images/manifest.json)。图片已打包，工具查询不依赖外网下载。

## 从仓库运行

```bash
cd beijing-food-map-mcp
npm ci
npm test
npm start
```

服务地址为 `http://127.0.0.1:8767/mcp`。其他终端中可执行：

```bash
codex mcp add beijing_food_map --url http://127.0.0.1:8767/mcp
codex
```

重新运行真实对话：`npm run test:codex`，需要本机已登录 Codex，且会实际调用模型。
单独图片测试：`npm run test:images`；图文预览再生成：`node scripts/preview-images.cjs`。
完整说明及 WorkBuddy 配置入口见 [项目 README](../beijing-food-map-mcp/README.md)。

本次入库复验使用锁文件重新安装依赖后运行 `npm test`，记录保存到
[repository-validation](../beijing-food-map-mcp/evidence/repository-validation/)。
历史 Codex 实际对话原样保留；此次归档未再次调用模型或改写已验收结论。

## 验证范围

排名仅覆盖十家样本及三个固定起点；距离为近似直线距离，没有路线规划或设备定位。
图片为原探店视频封面，可能包含菜品、博主和文字。
Codex CLI 的图片接收及 Markdown 输出已验，Codex 图形界面和 WorkBuddy 的最终渲染未实测。
本次上传包含代码、数据、图文结果和证据，没有部署常驻服务。
