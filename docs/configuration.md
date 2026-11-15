# 配置参考

配置来源优先级（后者覆盖前者）：

1. `src/config.js` 里的 `DEFAULTS`
2. `config.json`（项目根目录，或 `SEO2API_CONFIG` 指定的路径）
3. `SEO2API_*` 环境变量
4. 代码中传入的 overrides（仅测试用）

生成默认配置：`node server.js --write-config`

## 完整字段

### 服务

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `host` | string | `0.0.0.0` | 监听地址。只给本机用设 `127.0.0.1` |
| `port` | number | `8787` | 监听端口 |
| `publicUrl` | string | `http://localhost:<port>` | 对外访问地址，用于生成报告链接与 llms.txt |
| `logLevel` | string | `info` | `debug` / `info` / `warn` / `error` / `silent` |

### 鉴权 `auth`

| 字段 | 默认 | 说明 |
|---|---|---|
| `mode` | `key` | `key` 需要 token；`none` 公开访问 |
| `adminToken` | 空 | 管理员 token。两种模式下都有效，为空则管理接口不可用 |
| `defaultQuotaPerMin` | `60` | 新建 key 的默认每分钟配额 |

> `mode=none` 时，任何人都能调用分析接口，但管理接口（建 key、备份、清理缓存）**仍然**需要 adminToken。这是刻意的：公开服务也需要有人能管。

### 限流 `rateLimit`

| 字段 | 默认 | 说明 |
|---|---|---|
| `windowMs` | `60000` | 令牌补充窗口 |
| `max` | `60` | 每窗口基础配额 |
| `burst` | `10` | 允许的突发量 |

实现是令牌桶 + 惰性补充（按经过时间算，不用定时器）。key 的 `quotaPerMin` 会覆盖 `max`。

### 抓取 `fetch`

| 字段 | 默认 | 说明 |
|---|---|---|
| `timeoutMs` | `12000` | 单次抓取总超时 |
| `connectTimeoutMs` | `6000` | 连接超时 |
| `maxBytes` | `4194304` | 单页最大字节数（4MB） |
| `maxRedirects` | `5` | 最大重定向跳数 |
| `concurrencyPerAudit` | `4` | 单次分析的并发抓取数 |
| `userAgent` | 见源码 | 抓取用的 UA。默认伪装成普通浏览器，因为部分站点会拒绝未知 UA |
| `fetchAuxiliary` | `true` | 是否抓 robots.txt / sitemap / llms.txt / favicon |

设 `fetchAuxiliary: false` 能把单次分析从约 3 秒降到约 1 秒，但「可发现性」和部分「AI 可读性」规则会跳过得分为默认值。

### 安全 `security`

| 字段 | 默认 | 说明 |
|---|---|---|
| `blockPrivateNetworks` | `true` | 禁止抓取内网/回环/链路本地地址 |
| `allowHosts` | `[]` | 主机白名单，非空时只允许这些域 |
| `denyHosts` | `[]` | 主机黑名单，优先于白名单 |

**不要在生产环境关闭 `blockPrivateNetworks`。** 它防的是 SSRF：别人让你去抓 `169.254.169.254`，就能读到云厂商的实例元数据。

### 缓存 `cache`

| 字段 | 默认 | 说明 |
|---|---|---|
| `ttlMs` | `300000` | 结果缓存时长（5 分钟） |
| `maxEntries` | `512` | 缓存条目上限（LRU） |
| `contentHashReuse` | `true` | 内容未变时标记 `contentUnchanged` |

同一 URL 的并发请求会合并成一次抓取（single-flight），防止缓存击穿。

### 上限 `limits`

| 字段 | 默认 | 说明 |
|---|---|---|
| `batchMax` | `20` | 单次批量分析最大 URL 数 |
| `historyMax` | `200` | 历史查询最大条数 |

## 环境变量对照

| 变量 | 对应字段 |
|---|---|
| `SEO2API_HOST` | `host` |
| `SEO2API_PORT` / `PORT` | `port` |
| `SEO2API_DATA_DIR` | `dataDir` |
| `SEO2API_PUBLIC_URL` | `publicUrl` |
| `SEO2API_LOG_LEVEL` | `logLevel` |
| `SEO2API_AUTH_MODE` | `auth.mode` |
| `SEO2API_ADMIN_TOKEN` | `auth.adminToken` |
| `SEO2API_RATE_MAX` | `rateLimit.max` |
| `SEO2API_FETCH_TIMEOUT_MS` | `fetch.timeoutMs` |
| `SEO2API_ALLOW_PRIVATE` | `security.blockPrivateNetworks`（取反） |
| `SEO2API_CACHE_TTL_MS` | `cache.ttlMs` |
| `SEO2API_CONFIG` | 配置文件路径 |
