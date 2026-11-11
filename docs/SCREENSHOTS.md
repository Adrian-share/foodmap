# 门店视频截图：可重复采集与入库

本流程用于给已收录门店补充对应到访的视频画面。当前北京首页 11 家门店均有真实视频截图：原有蓉亭食贝截图保留，本次补齐原十家门店。图片与门店、到访、BV、分 P、时间点、SHA-256 一起保存；截图不会改变门店的收录资格。

## 从干净仓库执行

需要 Node.js 20+、可访问 B 站官方播放器的网络。仓库已有 Playwright 依赖；可使用标准 `HTTPS_PROXY` / `HTTP_PROXY`，无代理时直接连接，不在文件或日志中保存代理凭据。

```sh
npm ci
npx playwright install chromium
npm run screenshots -- plan
npm run screenshots -- capture
npm run screenshots -- gallery
```

默认目标来自 `data/catalog.json` 已验收门店和 `content/config.json` 已启用批次中审核通过的到访；目前共 11 条北京到访。未核准分店不会被脚本提升为正式门店。输出保存在 `content/review-frames/screenshots/`（Git 忽略），其中 `index.html` 可以直接用浏览器打开。

## 选帧与审核

默认在到访片段的 20%、45%、70% 取三帧。旧目录尚无片段标注时，采用播放器报告的全片时长。查看审核页，每家选择一张；填写客观画面描述、审核说明和审核人，然后点击“导出 review.json”。

- 核对 BV、分 P、时间点及门店到访关系；不得用别家或另一次到访的画面补位。
- 主体清晰，不选黑屏、转场、广告、遮挡或只有播放器控件的画面。菜名、价格和观点仅在原片提供证据时引用。
- 保留完整视频画幅和原片字幕、水印。脚本仅隐藏播放器 HTML 控件和推荐浮层，不修补或生成视频内容。
- 默认采样不保证选到合适画面。需要时针对视频重新取帧：

```sh
npm run screenshots -- capture --bvid BV1CB4y147BG --seconds 30,60,170.1
npm run screenshots -- gallery
```

`capture` 校验已有文件哈希并跳过重复帧；`--force` 强制重新采集。失败保存在 `manifest.json.failures`，命令返回非零退出码。网络或播放器受限时，检查失败项后重跑；不得将封面或生成图片标作视频截图。

## 入库与验证

把导出的文件放到仓库内，例如 `evidence/screenshots/review.json`，执行：

```sh
npm run screenshots -- apply --review evidence/screenshots/review.json
npm run content:build
npm run test:screenshots
npm test
npm run test:home
npm run test:content:page
npm run build:hosted
```

`apply` 在任何写入之前校验所有选择的来源、实际 seek 时间、视频解码状态、图像签名和哈希，并要求明确审核结论。旧门店写入 `content/baseline-screenshots.json`，新批次写回原批次的 `visit.screenshots`；图片进入 `content/images/`。对相同审核文件重复执行不会追加重复记录。`content:build` 再核对文件内容，把图片和关系编入 Node、Worker、HTTP、MCP 共用的快照。

截图入库后再按仓库现有部署方式发布；只运行采集命令不会改变网站。撤回旧门店截图时删除登记项再重建；撤回新批次截图时删除其 `visit.screenshots` 项再重建。门店依然保留，页面显示“截图待补”。

发布后执行 `node scripts/verify-screenshots-hosted.cjs`，逐店核对线上图片字节、详情来源及时间，并保存桌面/手机端截图。可用 `FOODMAP_DEPLOYMENT_URL` 指定待验收网址、`FOODMAP_EVIDENCE_DIR` 指定证据目录。

## 审核文件格式

以下是结构示意；`sha256` 必须从本次 `manifest.json` 复制，不能用占位值入库：

```json
[
  {
    "visit_id": "visit-beijing-1",
    "file": "BV1CB4y147BG-p1-170100.jpg",
    "sha256": "从采集清单复制完整的 64 位哈希",
    "approved": true,
    "reviewed_by": "审核人或 agent 名称",
    "alt": "博主在餐桌前用筷子夹起食物试吃",
    "review_note": "已查看原尺寸画面，核对来源和时间，主体清晰且保留原片水印"
  }
]
```

本次审核与采集证据在 `evidence/screenshots/review.json`、`capture-manifest.json`。脚本是 `scripts/screenshots.cjs`，旧入口 `scripts/capture-content-frames.cjs` 转发到同一实现，不维护两套逻辑。脚本只保存浏览器渲染的静态 JPEG，不下载或托管视频文件；视觉核对不等同于作者授权声明。
