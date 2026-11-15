# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.0] — 2026-11-15

面向「可以上线交付」的最后一次收尾。核心是**修掉检测器自己的误报**，并让服务自身的页面经得起被它自己检测。

### 修复：会误报的规则

误报比不报更糟——用户会照着错误结论去改本来正确的东西。以下四条在自己身上都能稳定复现：

- **`render-blocking` 把 JSON-LD 算成阻塞脚本。** `application/ld+json` 不是可执行脚本，浏览器不会为它阻塞解析。之前的结果是「加了结构化数据反而被扣性能分」。
- **`text-html-ratio` 用字符数除以字节数。** 中文一个字占 3 字节，中文站点的比值会被硬压到三分之一，永远判成「内容稀薄」。现在两边都按字节算。
- **`keyword-focus` 把中文标题拆成大量重叠片段。** 一个 6 字标题能生成十几个互相重叠的 bigram，正文里没原样复现每一个就判「主题不一致」。改为按语义片段取词 + 2-gram 覆盖率兜底。
- **`heading-as-question-density` 用英文字数门槛衡量中文标题。** 中文 4 字已经能讲清事（「快速开始」），套用「至少 6 字符」会把正常中文标题全判成信息量不足。

### 修复：辅助资源抓取

- `robots.txt` 里声明的 `Sitemap` 常写成对外域名（`https://…`）。本地部署、内网部署或端口不同的场景下，那一跳必然失败，于是整站被判「没有 sitemap」。现在会回退到当前页面的 origin 再试一次。
- `preconnect-hints` 把普通外链域名也算作「需要预连接的第三方资源」。只有脚本/样式/图片/iframe 的域名才和 preconnect 有关。

### 改进：服务自身的页面

- 补齐 `canonical`、`og:url`、`og:image:width/height`、`twitter:*`。
- 结构化数据改为 `@graph`：`WebSite` + `Organization` + `BreadcrumbList` + `WebPage`，首页与文档页额外带 `FAQPage`。
- 增加「跳到主内容」链接（WCAG 2.4.1）。
- 报告页与 404 页标 `noindex`，不占用站点索引预算。
- CSS 与首页脚本从内联改为外置静态资源（`/assets/app.css`、`/assets/app.js`），带内容指纹与 `immutable` 缓存，支持 `If-None-Match`。首页 HTML 从 16.8KB 降到 13.9KB，文本/HTML 比例从 6.2% 升到 13.3%，这条规则不再永远失败。
- 页面响应加 `Content-Security-Policy`、`Permissions-Policy`；CSP 的 `script-src` 不再需要 `unsafe-inline`。
- 页面响应启用 brotli/gzip 压缩，首页传输体积 13.9KB → 3.8KB。
- 修复 `/site.webmanifest` 404（文件存在但没挂路由）。
- 修复 404 页页脚版本号硬编码为 `1.0.0`。

### 修复：运维细节

- `node scripts/seo2api.js doctor | head` 会抛 `EPIPE` 堆栈。命令行工具被管道提前关闭时应安静退出。
- Node.js 版本要求从 `>=22.5` 修正为 `>=22.13`。实测 22.5 与 22.12 都需要 `--experimental-sqlite` 才能加载 `node:sqlite`，22.13 起才默认可用。

### 文档

- README、`docs/` 与页面文案同步更新；补 FAQ 与作者信息。
- 新增 `CHANGELOG.md`、`VERSION`、`.github/workflows/ci.yml`。

### 测试

- 从 200 项增加到 **217 项**，新增用例专门守住上面每一条误报与页面自审要求。全部通过。

## [1.0.0] — 2026-11-15

首个版本。

- 8 个维度 84 条规则：内容质量、技术规范、性能与体验、可发现性、社交与摘要、可访问性、安全性、AI 可读性。
- 评分 = 0.7 × 加权算术平均 + 0.3 × 加权几何平均；`noindex` 或 HTTP 失败强制压到 35 分以下。
- 修复优先级 = 影响 ÷ 工作量，报告直接给出「先改这三条，预计涨 X 分」。
- 零第三方依赖：仅用 Node 内置模块与 `node:sqlite`。全部状态一个 SQLite 文件，备份即复制。
- 手写抓取器做 SSRF 防护：逐跳重定向校验、按已校验 IP 连接、防 DNS 重绑定。
- API Key 只存 SHA-256 哈希，token 比对用 `timingSafeEqual`，限流按 key 隔离。
- 接口：单页分析、批量、历史趋势、报告对比、SVG 徽章、定时监控 + webhook、管理员接口、Prometheus 指标。
- Docker 与 systemd 部署，`doctor` / `backup` / `restore` / `keygen` 等运维命令。
