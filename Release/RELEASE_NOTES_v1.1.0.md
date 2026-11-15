# Seo2Api v1.1.0

> 网站 SEO 检测、评分与监控 API。8 个维度 84 项检查，零第三方依赖，一个 Node 进程 + 一个 SQLite 文件。

这是「可以上线交付」的版本。核心不是加功能，而是**修掉检测器自己的误报**，并让服务自身的页面经得起被它自己检测。

## 亮点

**AI 可读性维度**——大多数 SEO 工具查的是「能不能被人搜到」。但越来越多流量入口是 AI 搜索和问答引擎，它们不点进页面，只摘取段落。所以单独做了一个维度，查的是「你能不能被抓取后引用」：`llms.txt` 是否存在、H2/H3 是不是问句、段落是否自包含、实体身份是否明确、事实密度够不够。权重只给 5%，因为这是新兴标准，不该绑架整站评分。

**修复优先级而不是问题清单**——84 条检查项如果只打勾打叉，用户看完还是不知道先改哪个。每条失败项带 `impact`（影响）与 `effort`（工作量），优先级 = 影响 ÷ 工作量。报告直接给出「先改这三条，预计涨 5.1 分」。

**能装与性能是同一件事**——只用 Node 内置模块和 `node:sqlite`，没有 `node_modules`，不需要 `npm install`。数据是一个 SQLite 文件：备份 = 复制 `data/`，迁移 = 拷到另一台机器。能坏的地方越少，越不容易坏。

**抓取器手写而不是 `fetch`**——因为每一跳重定向都要重新做 SSRF 校验，并按已校验的 IP 发起连接，防止 DNS 重绑定。用 `fetch` 图省事，`http://127.0.0.1` 或云厂商元数据地址就能被当成正常目标。

## 本次修掉的误报

误报比不报更糟——用户会照着错误结论去改本来正确的东西。以下四条在自己身上都能稳定复现：

| 规则 | 症状 | 原因 |
|---|---|---|
| `render-blocking` | 加了结构化数据反被扣性能分 | `application/ld+json` 被当成可执行脚本 |
| `text-html-ratio` | 中文站点永远判「内容稀薄」 | 用字符数除以字节数，中文一字占 3 字节 |
| `keyword-focus` | 中文标题永远判「主题不一致」 | 一个 6 字标题能拆出十几个重叠 bigram |
| `heading-as-question-density` | 正常中文小标题被判信息量不足 | 套用了英文「至少 6 字符」门槛 |

另外两处抓取问题：`robots.txt` 里声明的 `Sitemap` 常写成对外域名，本地部署那一跳必然失败，于是整站被判「没有 sitemap」——现在会回退到当前 origin 重试；`preconnect-hints` 把普通外链域名也算作需要预连接的资源，现在只统计脚本/样式/图片/iframe 的域名。

## 服务自身

一个号称检测 SEO 的服务，自己的页面缺 canonical、缺 og:url、不压缩、没有跳转链接，是最好笑的 bug。这一版补齐：

- `canonical`、`og:url`、`og:image:width/height`、`twitter:*`
- 结构化数据改为 `@graph`：`WebSite` + `Organization` + `BreadcrumbList` + `WebPage`，首页与文档页带 `FAQPage`
- 「跳到主内容」链接（WCAG 2.4.1）
- 报告页与 404 页标 `noindex`，不占索引预算
- CSS/JS 外置为带指纹的静态资源，首页 HTML 16.8KB → 13.9KB，压缩后传输 3.8KB
- 页面响应加 CSP（`script-src 'self'`，不再需要 `unsafe-inline`）与 `Permissions-Policy`

自审结果：首页与文档页从 B（83.8）升到 A+（95.9）。

## 其它修复

- `node scripts/seo2api.js doctor | head` 会抛 `EPIPE` 堆栈——被管道提前关闭时应安静退出。
- `/site.webmanifest` 404（文件存在但没挂路由）。
- 404 页页脚版本号硬编码为 `1.0.0`。
- Node.js 要求从 `>=22.5` 修正为 `>=22.13`：实测 22.5/22.12 都需要 `--experimental-sqlite`，22.13 起才默认可用。

## 验证

- **217 项测试全部通过**（`node --test test/*.test.js`），新增用例专门守住上面每一条误报与页面自审要求。
- 冒烟流程：冷启动 → `/health` → 首页/文档/llms.txt/robots.txt/webmanifest/CSS → 真实站点分析 → 徽章 → 备份 → 列表，全部通过。
- CI 矩阵覆盖 Node 22.13 / 22.x / 24.x。

## 快速开始

```bash
git clone https://github.com/techjiang/Seo2Api.git seo2api && cd seo2api
export SEO2API_ADMIN_TOKEN=$(head -c 24 /dev/urandom | base64)
node server.js                    # → http://localhost:8787

node scripts/seo2api.js doctor    # 上线前自检
node scripts/seo2api.js keygen 我的应用 120
node scripts/seo2api.js backup
```

Docker：

```bash
SEO2API_ADMIN_TOKEN=$(head -c 24 /dev/urandom | base64) docker compose up -d
```

## 一句实话

「不能有任何问题和 Bug」这条没法字面兑现——软件没有零 bug 这回事，说这话的都是在骗人。能给的是：217 项测试覆盖规则正确性、误报回归、畸形 HTML 容错、SSRF 拦截、鉴权、限流、备份恢复、目录穿越，以及端到端验过的冷启动与完整业务流程。

发现问题是正常的，提到 <https://github.com/techjiang/Seo2Api/issues> 就好。

---

**作者：科技酱** · <https://www.asoe.cn> · <https://docs.asoe.cn> · <https://github.com/techjiang/>
