# 探店地图部署流程

## 已选择的方案

采用 Sites 的托管 Worker 运行网页和同源高德代理，使用平台提供的 HTTPS 地址。它不连接 `118.196.112.201`，不依赖 `shareworld.fun` 的解析、证书或该大陆服务器的备案进度。本轮发布北京地图基线，来源为 FACT-4 / `3183f27`；北京上海整合和 MCP 的新业务版本仍由 FACT-7 继续完成，不能把本次部署验证当作其验收。

入口：`https://shareworld-foodmap.yzxpg95.chatgpt.site`。是否已成功发布以平台部署状态、`/healthz` 和本轮验证报告为准；创建 Site 返回的预期 URL 不能单独证明上线。

保留 Node 运行方式，业务路由统一放在 `beijing-food-map/amap-handler.cjs`。Node 入口负责 HTTP 和读文件；`deployment/worker.mjs` 使用相同处理器并提供打包资产、运行时凭据和 `/healthz`。页面、十家门店和排序算法沿用已验收基线。

## 首次准备

1. Node.js 20+，在仓库根目录执行 `npm ci`，在 `beijing-food-map/` 执行 `npm ci`。
2. 已有 Site 的身份在 `.openai/hosting.json`，必须复用 `project_id`，不要每次发布重新创建网站。
3. 通过 Sites 环境变量管理配置 `AMAP_WEB_SERVICE_KEY`、`AMAP_JS_KEY`、`AMAP_JS_SECURITY_CODE`，均设为秘密值。前两类 Key 各有用途，不能互换；只有公开的 JS Key 可由配置接口返回。不得把安全密钥写进浏览器、源码、部署清单或打包产物。
4. 若高德 JS Key 启用了域名白名单，将实际访问域名加入。网站的默认地址与未来自定义域名分别核对。
5. 本轮按可分享网页的用途设置公开访问；后续发布保持现有受众。修改受众应作为单独的明确操作。

## 每次发布

1. 在任务分支修改代码，确认业务版本来源和待发布范围。
2. 根目录运行 `npm test`；在 `beijing-food-map/` 运行 `npm run test:page`。浏览器首次使用时安装 Playwright Chromium，或设 `PLAYWRIGHT_CHANNEL=chrome` 使用已有 Chrome。
3. 根目录运行 `npm run build:hosted`，生成 `dist/server/index.js` 和部署元信息。构建输出不含密钥，`/healthz.release` 是参与构建的源码内容摘要，用于核对上线版本。服务请求使用 `redirect: manual` 并拒绝上游重定向；Workers 不支持 Node Fetch 可用的 `redirect: error`。[运行时差异](https://developers.cloudflare.com/workers/runtime-apis/request/)
4. 获取该 Site 的 source repository write credential，通过 Sites 技能的 `site-workflow.mjs` 完成源码提交、推送和打包。凭据仅经隐藏 stdin 传给助手，不存入仓库；打包文件放在源码目录之外。输入的 `credential` 使用工具返回的完整对象，`source` 使用打开源码时的完整结果；`commands` 依次为 `["npm", "test"]` 与 `["npm", "run", "build:hosted"]`，`archivePath` 为源码目录以外的绝对打包路径。helper 的安装位置由当前 Sites 技能提供。

5. 把 helper 返回的 `project_id`、`commit_sha`、`archive` 原样交给 `save_site_version`，再使用返回的版本 ID 调用 `deploy_site_version`。必须推送与打包一致的源码，不可用旧归档搭配新提交。环境变量变更后也必须重新部署使其生效。
6. 部署若尚未完成，继续查询同一个 deployment ID；成功后记录平台返回的实际 URL、版本 ID、源码提交和发布结果。失败时保留旧版本，修复后发布；不要仅凭 URL 格式或保存成功就宣称上线。
7. 运行下面两项公网验收；保存 JSON、浏览器结果及截图，再交付链接。一次只发布一项已验收变更，不把未完成的 FACT-7 本地修改带入。

```sh
# 仓库根目录：验证 HTTPS、健康状态、静态资源、配置、三个真实地点和错误路径
npm run verify:deployment -- https://shareworld-foodmap.yzxpg95.chatgpt.site

# beijing-food-map/：直接访问线上站点，不启动本地服务，不拦截高德请求
FOODMAP_DEPLOYMENT_URL=https://shareworld-foodmap.yzxpg95.chatgpt.site \
  npx playwright test --config playwright.hosted.config.cjs
```

每次浏览器验收必须有 3 条实际执行并通过的用例；跳过不能视为通过。截图和起点/排序 JSON 写在 `beijing-food-map/test-results/`，属于本次测试输出，不提交为历史基线。若实际网络限制导致底图失败，应如实记录，不能用离线示意图代替真实地图验收。

网络验收分别记录浏览器、命令行和实际出口。验收脚本尊重 `HTTPS_PROXY`，只在结果中标注是否使用代理，不输出代理凭据；可用 `FOODMAP_NO_PROXY=1` 比较直连。本次环境出现过直连命令行被平台 WAF 返回 403、配置代理后健康接口 200 的差异，因此不得声称所有网络都能直连，也不能通过关闭 TLS 校验或伪造成功来消除失败。面向实际用户发布前应在目标网络再次打开完整页面。

## 回退与后续演进

- 回退：在 Sites 的历史保存版本中找到上一已验收版本，重新部署该版本并运行相同公网检查。不要删除旧版本或强制覆盖源码历史。
- 完成 FACT-7 后，把双城页面和 API 适配到相同 Worker 请求处理接口，先完成其业务验收，再走本流程发布。当前流程不会自动把其他任务未合并的代码变为生产版本。
- Token Hub 若依赖数据库、长连接、文件系统或后台任务，需要独立确认运行环境，不能直接套用这个地图 Worker 包。
- 平台默认域名可先用于验证；将来若使用 `map.shareworld.fun`，再办理域名绑定、DNS、证书和高德白名单，仍需核实最终托管位置及适用要求。新域名部署完成前保留旧入口。

## 为什么不把大陆服务器的 IP + 端口作为免备案路径

火山明确说明，使用中国大陆服务器 IP 地址直接提供网站服务同样需要备案；更换端口不改变服务器所在地。[火山官方说明](https://docs.volcengine.com/docs/record/basic-concepts-of-filing-faq?lang=en)。本轮选择独立托管来验证发布流程，未把大陆服务器通过隧道转发成所谓免备案站点。
