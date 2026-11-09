# 探店地图

北京附近探店 MCP：用户提供地点后，从十家固定样本中返回最近三家，每家包含一张真实的原探店视频封面、名称、直线距离和探店出处。

FACT-5 的实现及图片增强已由用户确认验收。本仓库保存已验收的代码、失败到通过的测试过程、Codex 实际对话与工具调用、最终图文结果及接入配置。

## 快速运行

需要 Node.js 20 或更新版本。

```bash
cd beijing-food-map-mcp
npm ci
npm start
```

MCP 地址：`http://127.0.0.1:8767/mcp`。保持服务运行，在另一个终端配置 Codex：

```bash
codex mcp add beijing_food_map --url http://127.0.0.1:8767/mcp
```

在项目目录运行 `npm test`，共 28 项原型、协议及图片测试；已安装并登录 Codex 后，可用 `npm run test:codex` 重跑四个真实会话。

## 代码、验证过程与结果

| 内容 | 入口 |
| --- | --- |
| 交付范围、过程、最终结果与验证边界 | [交付说明](docs/DELIVERY.md) |
| 启动、完整测试、Codex 及 WorkBuddy 接入 | [项目 README](beijing-food-map-mcp/README.md) |
| 只读 MCP 工具 | [mcp-server.cjs](beijing-food-map-mcp/mcp-server.cjs) |
| 原有十家样本与距离排序 | [samples.js](beijing-food-map-mcp/samples.js) |
| 图片资产、出处与哈希 | [图片清单](beijing-food-map-mcp/assets/images/manifest.json) |
| 首版失败到通过、四个 Codex 用例 | [首版验证报告](beijing-food-map-mcp/VALIDATION.md) |
| 图片增强、28 项测试及四个 Codex 图文用例 | [图片验证报告](beijing-food-map-mcp/IMAGE-VALIDATION.md) |
| 首版 Codex 完整对话 | [对话及工具记录](beijing-food-map-mcp/evidence/codex/conversations.md) |
| 图片版 Codex 完整对话 | [图文对话及工具记录](beijing-food-map-mcp/evidence/codex-images/conversations.md) |
| 完整协议、失败及成功测试、原始 JSONL 记录 | [evidence](beijing-food-map-mcp/evidence/) |
| 可离线打开、出处可点击的最终图文结果 | [下载 HTML 预览](beijing-food-map-mcp/evidence/images/images-preview.html) |
| 已验收附件与本次入库文件的逐字节校验 | [导入清单](docs/accepted-delivery-manifest.json) |

## 最终图文预览

以下截图由真实 MCP 响应中的 JPEG 和门店结果生成。独立 HTML 预览内嵌图片，下载后可离线打开。

![王府井、东坝、大钟寺的每店一图结果](beijing-food-map-mcp/evidence/images/images-preview.png)

距离为 GCJ-02 样本坐标计算的近似直线距离，排名仅限十家固定样本。图片为各店原探店视频封面。
Codex CLI 已验证收到图片字节并生成 Markdown 图片；上述预览不是 Codex 图形界面截图，WorkBuddy 客户端仍未实测。
