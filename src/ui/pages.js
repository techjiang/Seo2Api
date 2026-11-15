import { layout, esc, AUTHOR } from './layout.js';
import { APP_JS_VERSION } from './assets.js';
import { renderReportPage } from './report.js';

/* ------------------------------ 首页 ------------------------------ */
export { renderReportPage };

export function renderHomePage({ cfg, version, dimensions }) {
  const faqs = [
    {
      q: 'Seo2Api 和 Lighthouse 有什么区别？',
      a: 'Lighthouse 衡量的是加载性能，Seo2Api 衡量的是「能不能被搜到、能不能被引用」。它检查 84 项 SEO 相关规则，输出可粘贴的修复代码，并为每条问题算出「影响 ÷ 工作量」的修复优先级，而不是给一张性能瀑布图。',
    },
    {
      q: '为什么强调零第三方依赖？',
      a: '因为部署成本就是维护成本。没有 node_modules、不需要 npm install、不连外部数据库，克隆下来 node server.js 就能跑。全部状态在一个 SQLite 文件里，备份是复制 data 目录，迁移是把目录拷到新机器。',
    },
    {
      q: '爬取别人的网站会不会有安全风险？',
      a: '抓取器是手写的，不是 fetch。域名先解析成 IP 再逐跳校验，内网、回环、链路本地与云元数据地址一律拒绝，连接时锁定已校验的 IP 以防止 DNS 重绑定。这样别人无法借你的实例去访问内网服务。',
    },
    {
      q: '「AI 可读性」维度到底查什么？',
      a: '查 llms.txt 是否存在、H2/H3 是不是问句、段落是否自包含、实体身份是否明确、事实密度够不够。权重只给 5%，因为这是新兴标准；但它对应的是 AI 搜索「只摘段落、不点链接」的真实流量变化。',
    },
  ];

  const body = `<section class="hero">
  <div class="hero-badge">v${esc(version)} · 零依赖</div>
  <h1>网站 SEO 检测<br><span class="h1-sub">一次请求说清楚</span></h1>
  <p class="lede">8 个维度 84 项检查，输出 0–100 分、逐条问题定位、可直接复制的修复代码。
  不装依赖、不连外部服务，一个 Node 进程 + 一个 SQLite 文件就是全部。</p>

  <form class="analyze" id="f" action="/" method="get" autocomplete="off">
    <div class="input-row">
      <input type="text" id="url" name="url" placeholder="输入网址，例如 example.com" aria-label="要检测的网址" required>
      <button class="btn btn-primary" type="submit" id="go">开始检测</button>
    </div>
    <div class="hint" id="hint">支持 <code>example.com</code> 或完整 URL；检测约 2–8 秒。</div>
  </form>

  <div class="stats-row">
    <div class="stat"><b>84</b><span>检查项</span></div>
    <div class="stat"><b>8</b><span>评分维度</span></div>
    <div class="stat"><b>0</b><span>第三方依赖</span></div>
    <div class="stat"><b>1</b><span>数据文件</span></div>
  </div>
</section>

<section>
  <h2>为什么不是又一个 Lighthouse</h2>
  <div class="grid features">
    <div class="card feature">
      <div class="fi">01</div>
      <h3>结论先给，代码随后</h3>
      <p class="muted">每条问题都附一段可直接粘贴的修复代码，不是"建议优化 canonical"这种废话。</p>
    </div>
    <div class="card feature">
      <div class="fi">02</div>
      <h3>按性价比排优先级</h3>
      <p class="muted">用「影响 ÷ 工作量」排序，告诉你先改哪三条能让分数涨最多。</p>
    </div>
    <div class="card feature">
      <div class="fi">03</div>
      <h3>AI 可读性维度</h3>
      <p class="muted">llms.txt、问答结构、段落自包含、事实密度——搜索变成"给答案"之后的新指标。</p>
    </div>
    <div class="card feature">
      <div class="fi">04</div>
      <h3>短板会拖垮总分</h3>
      <p class="muted">算术均值与几何均值混合：一个维度崩了，其它满分也救不回来。</p>
    </div>
    <div class="card feature">
      <div class="fi">05</div>
      <h3>变化看得见</h3>
      <p class="muted">每次检测都存快照，能对比"修完这一个问题，分数从哪涨到哪"。</p>
    </div>
    <div class="card feature">
      <div class="fi">06</div>
      <h3>备份就是复制</h3>
      <p class="muted">全部状态在一个 SQLite 文件里。迁移 = 拷走 data 目录，不用导库。</p>
    </div>
  </div>
</section>

<section>
  <h2>评分维度</h2>
  <div class="dim-list">
    ${dimensions.map((d) => `<div class="dim-row">
      <div class="dim-name">${esc(d.name)}</div>
      <div class="dim-bar"><i style="width:${d.weight * 100 * 3.6}%"></i></div>
      <div class="dim-w">${(d.weight * 100).toFixed(0)}%</div>
      <div class="dim-desc">${esc(d.desc)}</div>
    </div>`).join('')}
  </div>
</section>

<section>
  <h2>三个命令跑起来</h2>
  <pre><code>git clone https://github.com/techjiang/Seo2Api.git seo2api &amp;&amp; cd seo2api
node server.js
# → http://localhost:8787</code></pre>
  <p class="muted">通过 API 调用一次，和其他服务一样用：</p>
  <pre><code>curl -X POST http://localhost:8787/v1/analyze \\
  -H 'content-type: application/json' \\
  -d '{"url":"example.com"}'</code></pre>
  <p class="muted">部署、备份、迁移与全部配置项见 <a href="/docs">文档</a>，运行时自检用 <code>node scripts/seo2api.js doctor</code>。</p>
</section>

<section id="faq">
  <h2>常见问题</h2>
  <div class="faq">
    ${faqs.map((f) => `<div class="card faq-item">
      <h3>${esc(f.q)}</h3>
      <p class="muted">${esc(f.a)}</p>
    </div>`).join('')}
  </div>
</section>

<section>
  <h2>作者与项目</h2>
  <div class="panel">
    <p style="margin:0 0 10px">Seo2Api 由 <strong>科技酱</strong> 开发并维护，MIT 协议开源，源码在
      <a href="${esc(AUTHOR.repo)}" rel="noopener">GitHub</a>。</p>
    <div class="author-links">
      <a href="${esc(AUTHOR.site)}" rel="noopener">www.asoe.cn</a>
      <a href="${esc(AUTHOR.docs)}" rel="noopener">docs.asoe.cn</a>
      <a href="${esc(AUTHOR.github)}" rel="noopener">GitHub</a>
      <a href="${esc(AUTHOR.bilibili)}" rel="noopener">哔哩哔哩</a>
      <a href="${esc(AUTHOR.forum)}" rel="noopener">玲珑论坛</a>
      <a href="mailto:${esc(AUTHOR.email)}">${esc(AUTHOR.email)}</a>
    </div>
    <p class="muted" style="margin:12px 0 0;font-size:13px">QQ 群：291974598 · 474819022 · 631167288</p>
  </div>
</section>

`;
  return layout({
    title: '网站 SEO 检测与评分 API',
    description: '提交一个网址，返回 8 个维度 84 项检查的评分、问题清单与可复制的修复代码。零第三方依赖，一个 Node 进程与一个 SQLite 文件即可部署。',
    body, cfg, version,
    path: '/',
    scripts: [`/assets/app.js?v=${APP_JS_VERSION}`],
    extraJsonLd: [{
      '@type': 'FAQPage',
      '@id': `${String(cfg.publicUrl || '').replace(/\/+$/, '')}/#faq`,
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    }],
  });
}

/* ------------------------------ 文档 ------------------------------ */
const ENDPOINTS = [
  {
    id: 'analyze', method: 'POST', path: '/v1/analyze',
    title: '分析单个网址',
    desc: '抓取页面并执行全部 84 项检查，返回完整报告。结果会存入历史，可用返回的 id 打开可视化报告页。',
    body: `{
  "url": "example.com",     // 必填，支持裸域名
  "fast": false,            // true 时跳过 robots/sitemap 等辅助抓取
  "compact": false          // true 时只返回分数与 Top5 问题
}`,
    resp: `{
  "ok": true,
  "cached": false,
  "data": {
    "id": "9f3c…", "score": 82.1, "grade": "B",
    "summary": { "headline": "…", "criticalCount": 0 },
    "dimensions": [{ "key": "content", "name": "内容质量", "score": 78.5 }],
    "priority": [{ "id": "og-basic", "estimatedGain": 3.4 }],
    "checks": [{ "id": "title-length", "status": "pass", "message": "…" }],
    "reportUrl": "http://localhost:8787/report/9f3c…"
  }
}`,
  },
  {
    id: 'batch', method: 'POST', path: '/v1/batch',
    title: '批量分析',
    desc: '一次最多 20 个网址，内部并发执行。单个失败不影响其它，结果里逐条带 ok 标记。',
    body: `{ "urls": ["a.com", "b.com"], "fast": true }`,
    resp: `{ "ok": true, "data": { "total": 2, "succeeded": 2, "averageScore": 74.5, "results": [...] } }`,
  },
  {
    id: 'history', method: 'GET', path: '/v1/history?url=example.com',
    title: '分数趋势',
    desc: '返回同一网址的历史快照与最近变化方向。',
    resp: `{ "ok": true, "data": { "trend": 4.2, "direction": "up", "items": [...] } }`,
  },
  {
    id: 'compare', method: 'GET', path: '/v1/compare?ids=A,B',
    title: '对比两份报告',
    desc: '输出修复项、退步项与各维度分数变化。也可用 ?url= 自动对比最近两次。',
    resp: `{ "ok": true, "data": { "delta": 6.3, "fixed": [...], "broken": [...], "verdict": "…" } }`,
  },
  {
    id: 'badge', method: 'GET', path: '/badge?url=example.com',
    title: '评分徽章',
    desc: '返回 SVG 徽章，可直接嵌进 README。带 10 分钟缓存，不会反复抓站。',
    resp: `<img src="/badge?url=example.com" alt="SEO 分数">`,
  },
  {
    id: 'watch', method: 'POST', path: '/v1/watches',
    title: '站点监控',
    desc: '定时巡检，分数变化 ≥1 分时 POST 到你的 webhook。',
    body: `{
  "url": "example.com",
  "label": "官网",
  "intervalMinutes": 1440,
  "webhookUrl": "https://your.app/hooks/seo"
}`,
    resp: `{ "ok": true, "data": { "id": 1, "nextRunAt": 1731… } }`,
  },
  {
    id: 'keys', method: 'POST', path: '/v1/admin/keys',
    title: '创建 API Key（管理员）',
    desc: '用 admin token 调用，明文 key 只返回一次。',
    body: `{ "name": "CI", "quotaPerMin": 120 }`,
    resp: `{ "ok": true, "data": { "key": "s2a_…" }, "warning": "只显示一次" }`,
  },
  {
    id: 'backup', method: 'POST', path: '/v1/admin/backup',
    title: '立即备份（管理员）',
    desc: '用 SQLite 的 VACUUM INTO 生成一致性快照，不阻塞读请求。',
    resp: `{ "ok": true, "data": { "file": "seo2api-2026-….db", "bytes": 65536 } }`,
  },
];

export function renderDocsPage({ cfg, version, dimensions }) {
  const base = String(cfg.publicUrl || '').replace(/\/+$/, '');
  const faqs = [
    {
      q: '没有任何依赖，怎么升级？',
      a: '覆盖代码目录后重启进程即可。数据结构由 PRAGMA user_version 管理，启动时自动迁移；备份是 data 目录里的一个 SQLite 文件，升级前后都可以直接复制使用。',
    },
    {
      q: '放在 Nginx 后面，限流为什么不准？',
      a: '限流按客户端 IP 计数，需要反向代理传 X-Forwarded-For。Nginx 用 proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for 即可，否则所有请求会被算成同一个 IP。',
    },
    {
      q: '想抓内网或本地站点怎么办？',
      a: '设置 SEO2API_ALLOW_PRIVATE=1 关闭内网拦截。生产环境不要关，否则这台机器能访问的内网地址都会变成别人的探测入口。',
    },
  ];

  const body = `<h1>文档</h1>
<p class="lede">全部接口、请求格式、错误码与运维方式。除徽章接口返回 SVG 外，所有响应都是 JSON。</p>

<section id="quickstart">
  <h2>快速开始</h2>
  <div class="panel">
    <p class="muted" style="margin:0 0 10px">要求 Node.js ≥ 22.13（内置 <code>node:sqlite</code> 需要该版本起才默认可用）。没有依赖，所以没有 <code>npm install</code>。</p>
    <pre><code>git clone https://github.com/techjiang/Seo2Api.git seo2api &amp;&amp; cd seo2api
export SEO2API_ADMIN_TOKEN=$(head -c 24 /dev/urandom | base64)
node server.js
# → ${esc(base)}</code></pre>
    <p class="muted" style="margin:10px 0 0">创建第一个 API Key：<code>node scripts/seo2api.js keygen 我的应用 120</code>，明文只显示一次。</p>
  </div>
</section>

<section id="auth">
  <h2>鉴权</h2>
  <div class="panel">
    <p class="muted" style="margin:6px 0 10px">默认需要 Token，放在 <code>Authorization: Bearer &lt;token&gt;</code> 或 <code>X-API-Key</code> 头里。管理接口只认 admin token。</p>
    <pre><code>curl -X POST ${esc(base)}/v1/analyze \\
  -H 'Authorization: Bearer s2a_xxx' \\
  -H 'content-type: application/json' \\
  -d '{"url":"example.com"}'</code></pre>
    <p class="muted" style="margin:10px 0 0">只想内网随便用？设置 <code>SEO2API_AUTH_MODE=none</code>。公开模式下管理接口依然需要 admin token。</p>
  </div>
</section>

<section id="endpoints">
  <h2>接口一览</h2>
  <div class="toc">
    ${ENDPOINTS.map((e) => `<a href="#${e.id}">${esc(e.method)} ${esc(e.path.split('?')[0])}</a>`).join('')}
  </div>
  ${ENDPOINTS.map((e) => `<section id="${e.id}" class="ep">
    <div class="ep-head"><span class="tag ${e.method === 'GET' ? 'info' : 'pass'}">${e.method}</span><code class="ep-path">${esc(e.path)}</code></div>
    <h3>${esc(e.title)}</h3>
    <p class="muted">${esc(e.desc)}</p>
    ${e.body ? `<div class="ep-label">请求</div><pre><code>${esc(e.body)}</code></pre>` : ''}
    ${e.resp ? (e.id === 'badge' ? `<div class="ep-label">用法</div><pre><code>&lt;img src="${esc(base)}/badge?url=example.com" alt="SEO"&gt;</code></pre>` : `<div class="ep-label">响应</div><pre><code>${esc(e.resp)}</code></pre>`) : ''}
  </section>`).join('')}
</section>

<section id="errors">
  <h2>错误码</h2>
  <div class="panel">
    <div class="kv"><span class="k">400 bad_request</span><span class="v">参数不合法</span></div>
    <div class="kv"><span class="k">401 unauthorized</span><span class="v">Token 缺失或无效</span></div>
    <div class="kv"><span class="k">403 forbidden</span><span class="v">目标地址被安全策略拒绝（内网/黑名单）</span></div>
    <div class="kv"><span class="k">404 not_found</span><span class="v">报告或接口不存在</span></div>
    <div class="kv"><span class="k">405 method_not_allowed</span><span class="v">方法不支持，响应头带 Allow</span></div>
    <div class="kv"><span class="k">413 payload_too_large</span><span class="v">请求体超过 1MB</span></div>
    <div class="kv"><span class="k">429 rate_limited</span><span class="v">超出配额，看 <code>retry-after</code></span></div>
    <div class="kv"><span class="k">502 upstream_error</span><span class="v">目标站点连接失败或 DNS 错误</span></div>
    <div class="kv"><span class="k">504 upstream_timeout</span><span class="v">目标站点超时</span></div>
  </div>
</section>

<section id="dimensions">
  <h2>评分维度</h2>
  <div class="panel">
  ${dimensions.map((d) => `<div class="kv"><span class="k">${esc(d.name)} · ${(d.weight * 100).toFixed(0)}%</span><span class="v">${esc(d.desc)}</span></div>`).join('')}
  </div>
  <p class="muted" style="font-size:13.5px">总分 = 0.7 × 加权算术平均 + 0.3 × 加权几何平均；<code>noindex</code> 或 HTTP 失败会把总分压到 35 以下。</p>
</section>

<section id="ops">
  <h2>备份、迁移与自检</h2>
  <div class="panel">
    <p class="muted" style="margin:0 0 10px">全部状态在 <code>data/</code> 一个目录里。备份用 SQLite 的 <code>VACUUM INTO</code>，拿到的是事务一致的快照，不是运行中 cp 出来的半个文件。</p>
    <pre><code>node scripts/seo2api.js doctor          # 上线前自检
node scripts/seo2api.js backup          # 生成快照到 data/backups/
node scripts/seo2api.js list            # 查看备份
node scripts/seo2api.js restore &lt;file&gt;  # 恢复（先校验，自动保留旧数据）</code></pre>
    <p class="muted" style="margin:10px 0 0">迁移到新机器：在老机器 <code>backup</code>，把整个 <code>data/</code> 拷过去，<code>node server.js</code> 就完事。没有导库脚本、没有版本兼容表。</p>
  </div>
</section>

<section id="faq">
  <h2>常见问题</h2>
  <div class="faq">
    ${faqs.map((f) => `<div class="card faq-item">
      <h3>${esc(f.q)}</h3>
      <p class="muted">${esc(f.a)}</p>
    </div>`).join('')}
  </div>
</section>`;
  return layout({
    title: 'API 文档：接口、错误码与部署运维指南',
    description: 'Seo2Api 完整接口文档：单个与批量分析、历史趋势、报告对比、评分徽章、定时监控、管理员接口，附请求示例、错误码表、评分维度说明与备份迁移操作步骤。',
    body, cfg, version, active: 'docs',
    path: '/docs',
    breadcrumb: [{ name: '首页', path: '/' }, { name: '文档', path: '/docs' }],
    extraJsonLd: [{
      '@type': 'FAQPage',
      '@id': `${base}/docs#faq`,
      mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    }],
  });
}

export function renderNotFoundPage({ cfg, version }) {
  return layout({
    title: '页面不存在',
    description: '请求的页面或报告不存在，可能已被清理。',
    body: `<div class="center" style="padding:80px 0">
      <h1>404</h1>
      <p class="muted">这份报告不存在，可能已被清理。</p>
      <p><a class="btn btn-ghost" href="/">回到首页重新检测</a></p>
    </div>`,
    cfg,
    version,
    path: '/404',
    noindex: true,
  });
}
