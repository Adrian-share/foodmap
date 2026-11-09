# 北京附近探店 MCP

一个只读的 `find_nearby_food` 工具，使用官方 MCP SDK v2 和 Streamable HTTP `POST /mcp`。
复用附件中原样保留的 `samples.js`，支持王府井、东坝、大钟寺及“望府井”别名，返回十家样本中最近三家。
每家店附一张原探店视频的真实封面、名称、直线距离及探店出处。图片已随代码保存，运行时无需访问 B 站。

## 安装与启动

需要 Node.js 20 或更新版本。本次验证环境为 Node.js 22.16.0；依赖精确版本保存在 `package-lock.json`。

```bash
cd beijing-food-map-mcp
npm ci
npm start
```

服务地址：`http://127.0.0.1:8767/mcp`。可用 `PORT=9876 npm start` 改端口。
保持终端运行，按 Ctrl+C 停止。验收脚本使用独立随机空闲端口，运行结束自动关闭，不占用 8767。
本轮没有部署持久服务；交付包可以按以上命令在客户端同一机器运行。

## 测试

```bash
# 原有网页原型基线：7 项
node --test acceptance.test.cjs

# 真正通过 SDK 进行 HTTP 初始化、工具发现和调用：15 项
npm run test:mcp

# 基线、协议及图片回归：28 项
npm test

# 单独验证图片完整性、图片协议及图文：6 项
npm run test:images

# 保存实际 initialize / tools/list / tools/call 请求与响应
node scripts/protocol-evidence.cjs

# 已安装并登录 Codex CLI 后，重跑四个真实会话验收
codex login status
npm run test:codex
```

Codex 验收会实际调用模型，使用当前 Codex 登录凭据，不需要在项目里填写密钥。
可用 `CODEX_BIN=/path/to/codex npm run test:codex` 指定可执行文件。
验收脚本使用临时调用级配置，忽略用户配置中的其他 MCP、禁用 shell 和项目说明读取，以免继承地点上下文。
四个用例使用四个不同会话 ID；MCP-04 第二轮通过明确的 ID 恢复首轮，用户输入严格只有“东坝”。
脚本检查真实服务端调用、起点、排序、距离、出处及用户回复，保存 JSONL、可读对话和服务端审计记录。
图片版会额外检查 Codex 收到的三个 JPEG 内容块及回复中的三张 Markdown 图片。
重跑会覆盖 `evidence/codex-images/` 内同名记录；需要保留本次证据时先复制目录。
`evidence/codex/` 保留首版纯文字验收记录。

## Codex 接入

先运行 `npm start`，在另一终端执行：

```bash
codex mcp add beijing_food_map --url http://127.0.0.1:8767/mcp
codex mcp list
codex
```

打开一个新会话，使用 `/mcp` 查看服务与工具。也可参照 `config/codex.config.toml.example` 添加配置。
下面三句各在独立新会话提问；自然语言中不需要指定工具或预期答案：

1. 我在王府井，附近有哪些探店餐厅？
2. 我现在住东坝，找三家最近的探店餐厅。
3. 大钟寺附近有哪些探店餐厅？

再开一个没有地点上下文的新会话，只问“我附近有什么？”。首轮应追问位置，无推荐、无地点解析。
等回复后，在同一会话只发送“东坝”，此时才调用工具查询。
服务器在 MCP 初始化 `instructions` 和工具描述中提供这一规则；缺位置的工具输入另有 `needs_location` 兜底。

配置格式和新会话恢复方式参考 [OpenAI 官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)及
[OpenAI 官方非交互模式文档](https://learn.chatgpt.com/docs/non-interactive-mode)。

## 工具输入与结果

```json
{"location":"东坝"}
```

工具只接受用户明确提供的地点文本（最多 80 字符），返回 `structuredContent`，同时以文本 JSON 提供相同内容以兼容客户端。
成功结构包含：

- `status: "ok"`；`origin` 的名称、经纬度、原始地图出处及 `coordinate_source: "sample_fixture"`。
- `coordinate_system: "GCJ-02"`；`distance_type: "straight_line"`；`sample_count: 10` 和排名范围说明。
- `results` 中三家完整门店名称、分店地址、GCJ-02 坐标、`meters`、`source`（探味）和 `video`（B 站）。
- 每家 `image` 中的可读取图片地址 `url`、原始封面地址 `original_url`、图片出处 `source`、图片说明 `alt`、类型及 SHA-256。
- `cards_markdown` 是已经排好的三条图文，每条包含一张图片、门店名称、直线距离和探店、视频出处。

MCP `content` 保留首个文本 JSON，随后逐店返回图文说明和一个标准 `image` 内容块（JPEG 的 base64 数据）。
这样客户端实际收到图片字节，不需要从第三方 CDN 下载图片。结构化结果也继续可供程序读取。
图片内容类型参考 [MCP 官方图片内容规范](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#image-content)。

## 图片来源与展示

十张图片均取自 `samples.js` 已有 B 站探店视频的原始封面，明确标记为“原探店视频封面”。
封面可能包含菜品、博主和文字。门店、视频 ID、原图 URL、下载地址、视频标题、获取时间和哈希记录在
`assets/images/manifest.json`；JPEG 位于同目录。原始十家门店数据不变。

服务通过只读 `GET /images/<视频ID>.jpg` 提供已登记图片，MCP 返回的图片地址默认使用当前服务主机和端口。
保持服务运行，支持 Markdown 图片的界面可以显示 `cards_markdown` 中的图片；不支持图片渲染的终端仍可显示文字及链接。
如果经代理连接，设置 `PUBLIC_BASE_URL` 为客户端实际可达的服务根地址（不带 `/mcp`），例如：

```bash
PUBLIC_BASE_URL=https://food.example.com npm start
```

代理需同时转发 `/mcp` 和 `/images/`，后端仍只监听本机回环，并保留 Host/Origin 校验。
本次 Codex CLI 已验证收到图片字节并生成 Markdown 图片；其终端文字输出不等同于图形客户端实际渲染。
WorkBuddy 图形界面仍未实测。

可以离线打开 `evidence/images/images-preview.html` 查看三处起点的图文样例，图片已内嵌；
`images-preview.png` 是该样例的实际浏览器截图。HTML 的出处链接可点击。
样例直接来自真实 MCP 工具响应，不是 Codex 图形界面截图。

```bash
# 从真实 MCP 响应重新导出自包含的图文预览
node scripts/preview-images.cjs

# 可选：重新获取十家店原视频的封面，需要 Python 3 及外网
npm run images:refresh
```

刷新会校验视频 ID、来源域名、JPEG 格式和大小；全部获取成功后才写入。
原图或网络服务不可用时脚本会失败，已交付图片仍可正常用于离线查询。
刷新后需重启服务以载入新资产，并重新运行 `npm test`。

`meters` 直接复用原型 Haversine 计算；在米制距离排序后取三家，显示时再换算为公里，不提前四舍五入排序。
样本预期值为：

| 起点 | 最近三家（直线距离） |
| --- | --- |
| 王府井地铁站 | 富春居 1.72 km、泰丰楼 1.92 km、北京宜宾招待所·餐厅 2.82 km |
| 东坝地铁站 | 寂川 8.11 km、潇湘阁 8.81 km、老吉堂·吉来 8.93 km |
| 大钟寺地铁站 | 洪福亮酒家 3.74 km、砂锅居 5.68 km、同和居 5.85 km |

空白、“我附近”等无地名输入返回 `needs_location`，`results: []` 且不进行地点解析。
不支持的地名返回 `location_not_found`，不会复用任何之前的起点。
工具无会话位置状态、无数据写入、无实时外部 API 调用；SDK 负责协议和参数校验。
成功与业务缺参均为结构化工具结果，非法类型等 schema 错误使用 SDK 的 `isError` 结果。

## WorkBuddy 配置（未实测）

`config/workbuddy/mcp.json` 可作为同机接入示例：

```json
{
  "mcpServers": {
    "beijing-food-map": {
      "type": "streamableHttp",
      "url": "http://127.0.0.1:8767/mcp",
      "timeout": 30000
    }
  }
}
```

`url` 替换为从 WorkBuddy 所在运行环境可达的完整 `/mcp` 地址，改端口时同步修改。
127.0.0.1 指客户端自己的机器，不能直接用于跨机器连接。本实现默认只监听回环，且校验 Host 和 Origin；
远程接入需另外配置转发到本机端口的通道及相应访问控制。
字段参考 [WorkBuddy 官方连接器文档](https://open.workbuddy.cn/docs/connector)。
本次仅交付配置，未安装、登录、联调或发布 WorkBuddy；其状态不计入 P0。

## 验证记录与范围

`VALIDATION.md` 记录首版验证；`IMAGE-VALIDATION.md` 记录本次图片增强和客户端验证边界。
`evidence/01-prototype-baseline.tap` 是原型基线；`02-mcp-red.tap` 是实现前失败；
`03-mcp-intermediate.tap` 保留 SDK 参数错误表达方式的测试修正记录；`04-all-green.tap` 是首版回归。
`05-protocol-exchanges.json` 含真实 HTTP 协议请求/响应。
`evidence/codex/` 含四个用例的用户问题、助手回复、真实工具事件及首轮零地点解析证据。
`evidence/images/01-images-red.tap` 是本次先写图片测试的失败记录；`02-images-green.tap` 是 28 项通过记录；
`03-protocol-exchanges.json` 包含图片增强后的实际 HTTP 协议响应。
`evidence/codex-images/` 保留图片版四个 Codex 用例的原始事件和完整图文回复。

固定坐标的 `source` 链接是样本中的地图出处，不代表本次访问了高德或重新确认了坐标。
探店与视频链接来自原始样本。本次已通过 B 站视频元数据取得对应封面，不验证餐厅营业状态或长期视频可用性。
排名仅限这十家样本，不是全北京餐厅排名；8 km 级的“最近”仍可能较远。
本轮不提供设备定位、IP 定位、账号位置记忆、博主筛选、路线规划或实时高德解析。
因此没有实时服务失败或多候选歧义路径；未知地点统一明确返回 `location_not_found`。
