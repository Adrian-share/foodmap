# ChatGPT 网页风格改版 · 桌面页面

本目录记录「探店地图」桌面页面（`beijing-food-map/index.html`，样式来自 `content/home-cards.css`）从 Perch Explore 绿色风格改版为 ChatGPT 灰阶视觉语言后的截图与说明。纯视觉改版：只改了 3 个 CSS 文件，未改任何 HTML / JS / 测试文件，DOM 结构与所有 id/class/aria 属性原样保留。

## 改了什么

### 全局设计令牌（三个 CSS 的 `:root` 统一）

| 令牌 | 值 |
| --- | --- |
| 页面背景 | `#fafafa` |
| 面板/卡片背景 | `#ffffff` |
| 主文字 | `#0d0d0d` |
| 次级文字 | `#6e6e73` |
| 边框 | `#e4e4e7` |
| 输入框边框 | `#d4d4d8` |
| 主操作按钮 | 背景 `#0d0d0d`、白字、hover `#1f1f1f`、圆角 12px |
| 链接/当前态 | 深色 `#0d0d0d` 加粗（去绿） |
| 选中态 | 深色描边/深色环形（不再绿色） |
| 焦点可见 | `outline: 3px solid #0d0d0d` |

圆角：卡片 16px；输入/搜索框 14–18px；小按钮/标签 10–12px。区块用 1px `#e4e4e7` 边框 + 充分留白区分；阴影仅 hover 时 `0 2px 8px rgba(0,0,0,.06)`。

### 各页改动点

**首页 `content/home-cards.css`（主要目标）**
- `.site-header` 白底 + 下边框 `#e4e4e7`；`.brand-mark` 由绿色块改为深色 `#0d0d0d` 圆角块；导航灰、当前项深色加粗；`.header-note` 灰。
- `.search-bar` 白底；`.search-field` 16px 圆角 + 1px `#d4d4d8` 边框，内部「搜索附近」按钮改深色圆角；`.creator-field` 同风格 16px 圆角灰边框。
- `.chips button` 灰底 `#f4f4f5` 圆角，选中态深色文字 + 浅灰边框。
- `.layout` 保持左地图右卡片两列、间距 28px、`max-width:1800px`。
- `.map-panel`/`.map-frame` 白底 16px 圆角 + `#e4e4e7` 边框；`.result-panel`/`.result-card` 白底 16px 圆角浅边框；`.frame-slot` 图片区背景改中性浅灰 `#f0f0f2`（图片仍 `object-fit:contain` 保留原色）。
- 卡片文字去彩色化：`.shop-select` 深色加粗；`.straight-distance` 改灰（`::after`「· 直线」保持灰）；`.video-byline` 灰底 `#f4f4f5` 灰字；`.video-note`/`.store-address` 灰；`.pin-number` 深色文字 + 浅灰圆底。
- 选中卡片 `#results>li[aria-current=true] .result-card` 深色 2px 环，`.result-body` 背景改极浅灰 `#fafafa`。
- `.sort-label`/`.eyebrow`/`#result-count`/`#map-status`/`.map-note`/`footer` 一律灰色系。
- `#load-more`（查看更多）深色白字主操作；`#clear-filter`/`#retry-search`/`#retry-map`/`#fit-map` 白底灰边灰字次操作。
- `#empty-state` 白底、虚线 `#d4d4d8` 边框、灰图标。
- 响应式断点（`min-width:1100px` 整屏布局、`max-width:1099px`、`max-width:760px` 移动端）逻辑不变，仅替换颜色/圆角。

**内容档案页 `content/style.css`**
- 同令牌：背景 `#fafafa`、文字 `#0d0d0d`、灰 `#6e6e73`、边框 `#e4e4e7`；`.card` 白底 16px 圆角浅边框。
- `.eyebrow`/`nav`/`footer` 灰；`.toolbar` 灰边；`.card button`/`#load-video` 深色主操作白字，次按钮白底灰边。
- `#review-note` 由黄底改浅灰底灰字；`dialog` 白底 `#e4e4e7` 边框；`dialog::backdrop` 深灰半透明。
- `.card img`/`.placeholder` 背景改中性浅灰 `#f0f0f2`，图片保留原色。

**博主合集页 `content/creators.css`**
- `--paper` 改 `#fafafa`；`--green` 不再作为 UI 主色，链接/当前项改深色 `#0d0d0d`。
- `.creator`/`.account`/`.video-card` 白底 16px 圆角浅边框；`.avatar` 浅灰圆底；`.badge` 灰底灰字（`.badge.pending` 去黄）。
- 「在本站播放」等按钮深色主操作白字，hover 浅灰；表格表头 `#f4f4f5` 灰底灰字；`dialog` 白底浅边；`.eyebrow` 灰。

## 保留的地图/图片原色

以下颜色按契约原样保留，仅 UI 外壳去彩色化：

- 门店地图图钉 `.map-pin` 绿色 `#18764f`（未选中白底绿字、选中绿底白字 `aria-pressed=true`）。
- 起点地图图钉 `.map-pin.origin` 蓝色 `#295c94`。
- `.origin-dot` 蓝 `#295c94`、`.shop-dot` 绿 `#18764f`。
- `prototype.js` 里 SVG 示意图的绿/蓝（CSS 管不到的 SVG 内部填充不受影响）。
- 卡片真实截图、内容页图片、合集页视频封面均 `object-fit:contain` 保留原色，仅容器背景改中性浅灰。

## 测试通过情况

全部相关回归通过（失败 0）：

| 命令 | 结果 |
| --- | --- |
| `npm run test:desktop` | 通过 3（node）+ 4（playwright），失败 0 |
| `npm run test:home` | 通过 3 + 4，失败 0 |
| `npm run test:page` | 通过 12，失败 0 |
| `npm run test:content:page` | 通过 3，失败 0 |
| `npm run test:content:integration` | 通过 2，失败 0 |
| `npm run test:creators` | 通过 5 + 4，失败 0 |

覆盖的契约包括：`#map[data-ready=true]`、`.map-panel` 在 `.result-panel` 左侧、`#query`/`#creator-filter` 同行（y 差 <12）、6 张结果卡、`.shop-select`/`.video-byline`/`.video-note` 非空、图片加载、`.straight-distance` 升序、图钉点击 ↔ 卡片 `aria-current` 双向联动、`查看更多`/`清除筛选`/`#current-origin`/`#empty-state`/`#video-dialog`/`#video-slot`/「截图待补」等；1280/1440/390 视口均无横向溢出。

## 截图文件列表

| 文件 | 视口 | 说明 |
| --- | --- | --- |
| `before-1280.png` | 1280×800 | 搜索前（拦截 `/api/nearby`，结果区为空） |
| `wangfujing-1280.png` | 1280×800 | 触发王府井搜索后的结果 |
| `before-1440.png` | 1440×900 | 搜索前 |
| `wangfujing-1440.png` | 1440×900 | 王府井结果后 |

截图由 `screenshot-redesign.cjs` 生成（复用基线脚本做法：`page.route` 替身高德 SDK 与 `/api/amap/config`，搜索前拦截 `/api/nearby` 使结果区为空）。
