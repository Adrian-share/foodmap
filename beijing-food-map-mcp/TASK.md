# 北京探店 MCP｜Multica 开发任务

基于附件中的现有原型，在远程 Codex 环境实现一个只读的「附近探店」MCP 服务。服务使用 Streamable HTTP，保留 WorkBuddy 接入方式。P0 客户端验收只在 Codex 完成。

## 工作顺序

1. 解压后进入 `beijing-food-map-mcp`，阅读《MCP-ATDD.md》。使用 Node.js 20 或更新版本运行 `node --test acceptance.test.cjs`，记录地图原型基线。
2. **先写 MCP 验收测试并记录失败。** 通过真实 MCP 协议测试初始化、工具发现和调用。固定外部地点解析响应或直接复用现有地点样本，以便远程环境无高德凭据时也能跑全套 P0。
3. **再实现一个附近探店工具。** 复用 `samples.js` 中原样保留的十家店、GCJ-02 坐标、探店和视频出处、三个起点及直线距离排序。复用现有原型的地点解析逻辑时，把测试样本与实时数据来源标清。MCP 服务输出结构化结果，现有网页文件用作参考和回归基线。
4. 用 Codex 连上运行中的 MCP 地址，在真实会话跑完三个地名及缺位置的两轮对话。交付实际工具调用和回复的证据。

## 接入和运行

- 用标准 MCP SDK 提供 Streamable HTTP `/mcp`，在远程任务内启动服务后让 Codex 连到同环境可达的地址。同一运行环境可以用回环地址，跨容器时使用远程运行环境可访问的地址。运行地址由开发任务实际填写。
- Codex CLI 示例为 `codex mcp add beijing-food-map --url http://127.0.0.1:8767/mcp`。在任务的测试配置中注册后开一个新会话。可用 `/mcp` 确认发现，再用自然语言检查实际调用。 [OpenAI Codex MCP 文档](https://learn.chatgpt.com/docs/extend/mcp#connect-codex-to-an-mcp-server)
- 附一个 WorkBuddy `mcp.json` 示例，写明服务器地址替换方式，传输类型使用 `streamableHttp`。WorkBuddy 的接入状态标为未实测，其安装、登录、内测和发布均不计入本轮完成条件。 [WorkBuddy 连接器文档](https://open.workbuddy.cn/docs/connector)
- 本包无凭据。若另行验证实时高德地点搜索，使用远程环境中的 `AMAP_WEB_SERVICE_KEY`。P0 可以用三个固定地点样本跑通真实 MCP 客户端调用。实时高德不属于 P0。

## 交付物

提交实现和测试、启动命令、Codex 接入步骤、WorkBuddy 配置示例，以及脱敏的验证记录。记录应包含测试从失败到通过的结果、三个有地点的会话和一个缺地点的两轮会话。服务端协议测试通过与 Codex 对话通过分别记录。

本轮只覆盖十家样本店、北京三个起点、直线距离及探店来源。设备定位、账号记忆、博主筛选、路线规划和平台发布可独立定义后续验收。当前数据包含视频链接，尚无结构化博主字段。
