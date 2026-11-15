<div align="center">

<img src="public/icons/logo-mark.svg" alt="Seo2Api" width="96" height="96">

# Seo2Api

**网站 SEO 检测、评分与监控 API**

8 个维度 · 84 项检查 · 0 第三方依赖 · 1 个数据文件

[![Node](https://img.shields.io/badge/Node.js-%E2%89%A522.13-22d3a5)](https://nodejs.org)
[![deps](https://img.shields.io/badge/dependencies-0-22d3a5)](package.json)
[![license](https://img.shields.io/badge/license-MIT-22d3a5)](LICENSE)
[![version](https://img.shields.io/badge/version-1.1.0-22d3a5)](CHANGELOG.md)

</div>

---

## 这是什么

一个能自己跑起来的 SEO 检测服务。提交一个网址，它抓取页面、跑 84 项检查、给出 0–100 分，并把每个问题配上可直接粘贴的修复代码。

它和 Lighthouse 的区别在于：**结论是给 SEO 用的，不是给性能用的**。没有依赖树、没有第三方服务、没有外部数据库——一个 Node 进程和一个 SQLite 文件就是全部。

```bash
node server.js
# → http://localhost:8787
```

## 快速开始

**要求**：Node.js ≥ 22.13（`node:sqlite` 从这个版本起默认可用）。不需要 npm install，因为没有依赖。

```bash
git clone https://github.com/techjiang/Seo2Api.git seo2api && cd seo2api

# 1. 写一份配置（可选，不写就用默认值）
node server.js --write-config

# 2. 设个管理员 token
export SEO2API_ADMIN_TOKEN=$(head -c 24 /dev/urandom | base64)

# 3. 启动
node server.js
```

打开 <http://localhost:8787>，输入网址就能看到报告。

### 创建第一个 API Key

```bash
node scripts/seo2api.js keygen 我的应用 120
```

它会打印一个 `s2a_...` 的 key（只显示一次），然后：

```bash
curl -X POST http://localhost:8787/v1/analyze \
  -H 'Authorization: Bearer s2a_xxx' \
  -H 'content-type: application/json' \
  -d '{"url":"example.com"}'
```

### 只想内网随便用？

```bash
SEO2API_AUTH_MODE=none node server.js
```

公开模式不需要 token，但管理接口（建 key、备份）仍然要 admin token。

## 它检查什么

| 维度 | 权重 | 检查内容 |
|---|---|---|
| 内容质量 | 22% | Title 长度与结构、Description、H1 唯一性、标题层级、正文体量、关键词密度 |
| 技术规范 | 18% | 可索引性、状态码、canonical、结构化数据、lang、viewport、charset、URL 结构 |
| 性能与体验 | 16% | HTML 体积、渲染阻塞、图片尺寸与格式、压缩、缓存、资源提示、响应耗时 |
| 可发现性 | 14% | robots.txt、robots 是否屏蔽当前页、sitemap、内链、锚文本、hreflang |
| 社交与摘要 | 10% | Open Graph、分享图、Twitter Card、favicon |
| 可访问性 | 10% | alt 文本、语义标签、表单标签、ARIA、跳过链接、语言一致性 |
| 安全性 | 5% | HTTPS、HSTS、CSP、混合内容、点击劫持、版本信息泄露 |
| **AI 可读性** | 5% | **llms.txt、问答结构、段落自包含、实体身份、事实密度** |

### 为什么有「AI 可读性」

搜索正在从"给链接"变成"给答案"。AI 搜索（Perplexity、ChatGPT Search、AI Overview、微信 AI 搜索）会先从页面抽取**可引用的事实块**，再组织答案。

一个页面能不能被引用，和传统 SEO 指标并不完全重合：

- 有没有 `llms.txt` 给模型一份站点导航
- 段落是否**自包含**（"它很好用"脱离上下文就没意义，摘不出来）
- 有没有问答式结构（FAQ 是 AI 最爱摘的形式）
- 有没有明确的实体身份（`Organization` / `Person`，帮 AI 消歧）
- 事实密度够不够（"约三成"不可引用，"32%" 可以）

这个维度是本系统的创新点，也是它会提醒你去写 `llms.txt` 的原因。

## 评分怎么算

```
维度分 = Σ(规则权重 × 通过率) / Σ规则权重 × 100
总分   = 0.7 × 加权算术平均 + 0.3 × 加权几何平均
```

用几何平均是为了**惩罚短板**：一个维度崩了，其它维度满分也救不回来。

还有硬性封顶：页面 `noindex` 或返回 4xx/5xx，总分直接压到 35 以下。不然会出现"92 分但根本搜不到"这种荒谬结论。

### 修复优先级

每条问题都算了 `影响 ÷ 工作量`：

```
影响   = 严重度 × 规则权重 × 维度权重
工作量 = 人工标注（改个 title 是 1，加结构化数据是 4）
```

所以报告里给你的顺序是"先改这三条，预计涨 7.5 分"，而不是 60 条问题的平铺清单。

## API

完整文档在 `/docs`，这里是速览。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/analyze` | 分析单个网址 |
| POST | `/v1/batch` | 批量分析（≤20 个） |
| GET | `/v1/report/:id` | 取历史报告 |
| GET | `/v1/reports` | 报告列表，支持 `url`/`host`/分页 |
| GET | `/v1/history?url=` | 分数趋势 |
| GET | `/v1/compare?ids=a,b` | 对比两份报告，列出修复与退步项 |
| GET | `/badge?url=` | SVG 评分徽章 |
| POST | `/v1/watches` | 创建定时监控 + webhook |
| GET | `/health` | 健康检查 |
| GET | `/metrics` | Prometheus 指标 |
| GET | `/v1/admin/keys` | Key 管理（需 admin） |
| POST | `/v1/admin/backup` | 立即备份（需 admin） |

### 请求示例

```bash
# 分析
curl -X POST http://localhost:8787/v1/analyze \
  -H 'Authorization: Bearer s2a_xxx' \
  -H 'content-type: application/json' \
  -d '{"url":"example.com"}'

# 只要分数和 Top5 问题（响应更小）
curl -X POST http://localhost:8787/v1/analyze \
  -H 'Authorization: Bearer s2a_xxx' \
  -H 'content-type: application/json' \
  -d '{"url":"example.com","compact":true}'

# 嵌进 README 的徽章
![SEO](http://localhost:8787/badge?url=example.com)
```

### 错误码

| 码 | HTTP | 含义 |
|---|---|---|
| `bad_request` | 400 | 参数不合法 |
| `unauthorized` | 401 | Token 缺失或无效 |
| `forbidden` | 403 | 目标地址被安全策略拒绝 |
| `not_found` | 404 | 报告不存在 |
| `rate_limited` | 429 | 超配额，看 `retry-after` |
| `upstream_error` | 502 | 目标站点连接失败 |
| `upstream_timeout` | 504 | 目标站点超时 |

`403` 通常意味着域名解析到了内网地址——这是 SSRF 防护在起作用。

## 备份、迁移、升级

**所有状态都在 `data/` 一个目录里。**

```bash
node scripts/seo2api.js backup      # 生成一致性快照到 data/backups/
node scripts/seo2api.js list        # 看备份列表
node scripts/seo2api.js restore <file>   # 恢复（先校验，自动保留旧数据）
```

迁移到新机器：

```bash
# 旧机器
node scripts/seo2api.js backup
scp -r data/ newhost:/path/to/seo2api/

# 新机器
node server.js
```

就这样。没有数据库导出、没有迁移脚本、没有版本兼容问题。

备份用的是 SQLite 的 `VACUUM INTO`，生成的是**一致性快照**——不是 `cp` 那种在写入过程中可能抓到半个事务的危险操作。

### 定时备份

```bash
# 每天凌晨 3 点
0 3 * * * cd /path/to/seo2api && /usr/bin/node scripts/seo2api.js backup
```

服务自己也会每天自动备份一次并清理 7 天前的用量日志。

## 部署

**Docker**

```bash
docker compose up -d
```

镜像基于 `node:24-alpine`，没有构建步骤，因为不需要装依赖。

**裸机（systemd）**

```ini
[Unit]
Description=Seo2Api
After=network.target

[Service]
Type=simple
User=seo2api
WorkingDirectory=/opt/seo2api
Environment=SEO2API_PORT=8787
Environment=SEO2API_PUBLIC_URL=https://seo.example.com
Environment=SEO2API_ADMIN_TOKEN=替换成你的随机串
ExecStart=/usr/bin/node server.js
Restart=always

[Install]
WantedBy=multi-user.target
```

放在 Nginx 后面时记得传 `X-Forwarded-For`，限流才能按真实 IP 计数。

## 自检

上线前跑一遍：

```bash
node scripts/seo2api.js doctor
```

它检查 Node 版本、`node:sqlite` 是否可用、目录权限、磁盘空间、admin token 强度、数据库完整性、备份新鲜度，并给出可直接照着做的修复建议。

## 配置

所有配置都能用环境变量覆盖，也可以放一个 `config.json`：

```json
{
  "port": 8787,
  "publicUrl": "https://seo.example.com",
  "auth": { "mode": "key", "adminToken": "your-random-token" },
  "rateLimit": { "max": 60, "burst": 10 },
  "fetch": { "timeoutMs": 12000, "maxBytes": 4194304 },
  "security": {
    "blockPrivateNetworks": true,
    "allowHosts": [],
    "denyHosts": []
  }
}
```

常用环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `SEO2API_PORT` | 8787 | 监听端口 |
| `SEO2API_HOST` | 0.0.0.0 | 监听地址 |
| `SEO2API_DATA_DIR` | ./data | 数据目录 |
| `SEO2API_PUBLIC_URL` | — | 对外地址，用于生成报告链接 |
| `SEO2API_AUTH_MODE` | key | `key` 或 `none` |
| `SEO2API_ADMIN_TOKEN` | — | 管理员 token |
| `SEO2API_RATE_MAX` | 60 | 每 key 每分钟配额 |
| `SEO2API_ALLOW_PRIVATE` | false | 是否允许抓内网（默认禁止） |
| `SEO2API_CACHE_TTL_MS` | 300000 | 分析结果缓存时长 |

## 安全设计

- **SSRF 防护**：域名先解析成 IP 再校验，内网/回环/链路本地/云元数据地址一律拒绝；每跳重定向都重新校验；连接时锁定已校验的 IP，防 DNS 重绑定。
- **API Key 只存哈希**：数据库里是 SHA-256，明文只在创建时返回一次。
- **常量时间比较**：token 比对用 `timingSafeEqual`，避免时序攻击。
- **限流按 key 隔离**：一个 key 被刷爆不影响别人。
- **响应体上限**：抓取最多 4MB，请求体最多 1MB，文档节点数有上限，防内存打爆。
- **目录穿越防护**：静态文件路径解析后必须在 `public/` 内。

## 测试

```bash
node --test test/*.test.js
```

217 项测试，覆盖规则正确性、误报回归、畸形 HTML 容错、SSRF 拦截、鉴权、限流、备份恢复、目录穿越、以及「站点自己能不能通过自己的审计」。

## 项目结构

```
server.js              入口
src/
  config.js            配置加载（默认值 + config.json + 环境变量）
  server.js            HTTP 服务、路由装配
  core/
    html.js            零依赖容错 HTML 解析器
    page.js            页面模型（规则只读这一层）
    fetcher.js         安全抓取（SSRF/超时/体积/重定向）
    netguard.js        SSRF 地址判定
    aux.js             robots/sitemap/llms.txt 解析
    analyzer.js        分析编排、批量、对比
    score.js           评分、等级、优先级排序
    db.js              SQLite 持久化、备份恢复
    cache.js           LRU + single-flight
    metrics.js         指标（Prometheus 格式）
  rules/               84 条规则，按维度分文件
  api/                 analyze/batch/watch/badge
  ui/                  首页、文档、报告页（服务端渲染）
public/                logo、favicon、OG 图
scripts/seo2api.js     运维 CLI
test/                  217 项测试
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。当前版本 1.1.0，主要变化是修掉四条会误报的检测规则、
补齐服务自身页面的 SEO 元信息、把内联 CSS/JS 改为可缓存的静态资源。

## 作者

**科技酱**

- 主站：<https://www.asoe.cn>
- 技术文档：<https://docs.asoe.cn>
- GitHub：<https://github.com/techjiang/>
- 哔哩哔哩：<https://space.bilibili.com/1768832152>
- 邮箱：<official@tech.asoe.cn>
- 玲珑论坛：<https://forums.asoe.cn/>
- QQ 群：291974598 / 474819022 / 631167288

问题与建议请提到 <https://github.com/techjiang/Seo2Api/issues>。

## 许可

MIT © 科技酱
