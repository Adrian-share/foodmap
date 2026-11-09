# 探店地图

北京探店交互式地图：输入北京地点，在高德底图上查看十家固定探店门店中按直线距离排序的最近三家，并打开正确分店的探店出处。

FACT-4 的代码、验收过程和最终结果均保存在本仓库。2026-11-10 已完成真实高德验收：17 项数据与服务端测试、9 项固定响应页面测试、3 项真实地图测试全部通过。

## 启动与测试

需要 Node.js 20+。在仓库根目录执行：

```sh
cd beijing-food-map
npm ci
npm start
```

访问 `http://127.0.0.1:8766/`。真实地图需要在运行环境配置 `AMAP_WEB_SERVICE_KEY`、`AMAP_JS_KEY`、`AMAP_JS_SECURITY_CODE`，参考 [配置与启动说明](beijing-food-map/README.md) 和 [空白环境变量示例](beijing-food-map/.env.example)。没有凭据时提供明确标注的离线固定样本演示。

```sh
# 在 beijing-food-map 目录执行
npx playwright install chromium
npm run test:all

# 在环境中配置完整高德凭据后执行
npm run test:live
```

## 代码与验收记录

| 内容 | 入口 |
| --- | --- |
| 页面、SDK 接入、搜索及安全密钥代理 | [beijing-food-map](beijing-food-map/) |
| 原始开发要求与验收用例 | [TASK.md](beijing-food-map/TASK.md) · [验收用例](beijing-food-map/验收用例.md) |
| 验证步骤、失败到通过的过程 | [验证过程索引](docs/verification/README.md) |
| 最终结果、实时点位与测试边界 | [验收报告](beijing-food-map/TEST-RESULTS.md) |
| 全部历史日志、截图、坐标与原型失败 trace | [2026-11-10 验证档案](docs/verification/2026-11-10/) |

## 真实高德地图结果

以下截图均同时显示真实高德道路底图、起点、编号 1–3 的门店图钉和结果列表。三个实时起点坐标与固定基准完全一致。

| 起点 | 最近三家（直线距离） | 截图 |
| --- | --- | --- |
| 王府井 | 富春居 1.72 km · 泰丰楼 1.92 km · 北京宜宾招待所·餐厅 2.82 km | [真实地图](docs/verification/2026-11-10/live-王府井.png) · [门店详情](docs/verification/2026-11-10/live-王府井-detail.png) |
| 东坝 | 寂川 8.11 km · 潇湘阁 8.81 km · 老吉堂·吉来 8.93 km | [真实地图](docs/verification/2026-11-10/live-东坝.png) · [门店详情](docs/verification/2026-11-10/live-东坝-detail.png) |
| 大钟寺 | 洪福亮酒家 3.74 km · 砂锅居 5.68 km · 同和居 5.85 km | [真实地图](docs/verification/2026-11-10/live-大钟寺.png) · [门店详情](docs/verification/2026-11-10/live-大钟寺-detail.png) |

历史证据固定在 `docs/verification/`；重新运行测试的输出写到应用目录内被 Git 忽略的 `test-results/`，不会覆盖归档。高德凭据由运行环境注入，不保存在仓库中。

## 托管部署

FACT-3 增加托管 Worker，与 Node 服务共用业务请求处理器。部署流程、验证和回退方法见 [部署说明](docs/deployment.md)。线上版本来源及网络验证范围以本轮部署报告为准。
