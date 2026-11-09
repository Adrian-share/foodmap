# 验收基线来源

仓库起始提交：`3f503b0`；当时 origin/main 仅有初始化 README，两份验收实现未推送。

- 地图：FACT-4，附件 `beijing-food-map-verified.zip`（01a1c11b-9b9d-7185-9ea5-1019dcbf62d5），2026-11-09 16:19 UTC 真实地图 3/3 通过。复用 index.html、prototype.js、amap-server.cjs、samples.js、全部原页面和服务测试。
- MCP：FACT-5，附件 `FACT-5-beijing-food-map-mcp-images.zip`（01a1c109-d3c8-7b14-bb1f-57d5190c303c），用户在评论 01a1c114-0e60-7340-90ca-4a1ce4a9cc34 明确验收。复用 mcp-server.cjs、images.cjs、图片、协议测试及 Codex 验收脚本。
- 两份原始 evidence、test-results 与验证报告一并保存；它们是历史证据，不能当作本轮结果。冲突文档收在 docs/mcp-baseline。

附件 SHA-256：

- FACT-5-beijing-food-map-mcp-images.zip: `090d72697cd5e5fbaff75f939f3036f96b81ae7b5b9d5e3034a3824109c40e38`

- beijing-food-map-verified.zip: `5812984a54f49dfdb955c397de9ffd2727820079a45e65edb110d0a04a433c63`

用户补充的原始成果目录已核对：

- FACT-4：`fact-4-8505a1050331/workdir/beijing-food-map/`；交付压缩包在 `deliverables/`，Git 工作副本 `foodmap/beijing-food-map/`。
- FACT-5：`fact-5-ddd7505603a8/workdir/beijing-food-map-mcp/`；Git 工作副本 `foodmap/beijing-food-map-mcp/`，原始交付 ZIP 在该 workdir。
- FACT-3：`fact-3-95a2a972d372/workdir/deployment-verification-result.md` 仅验证 DNS、HTTP、证书；它未部署探店业务，不能作为本功能上线证据。
- 本轮整合工作副本：`fact-7-c72be9d584e1/workdir/foodmap/`。以上路径用于追溯，不是交付下载链接。
