import { layout, esc } from './layout.js';
import { REPORT_CSS } from './report-css.js';
import { HOME_CSS } from './home-css.js';
import { renderReportPage } from './report.js';

/* ------------------------------ 首页 ------------------------------ */
export { renderReportPage };

export function renderHomePage({ cfg, version, dimensions }) {
  const body = `<style>${HOME_CSS}</style>
<section class="hero">
  <div class="hero-badge">v${esc(version)} · 零依赖</div>
  <h1>网站 SEO 检测，一次请求说清楚</h1>
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
      <p class="muted">用「影响 ÷ 工作量和」排序，告诉你先改哪三条能让分数涨最多。</p>
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
  <pre><code>git clone &lt;repo&gt; seo2api &amp;&amp; cd seo2api
node server.js
# → http://localhost:8787</code></pre>
  <p class="muted">调用一次：</p>
  <pre><code>curl -X POST http://localhost:8787/v1/analyze \\
  -H 'content-type: application/json' \\
  -d '{"url":"example.com"}'</code></pre>
</section>

<script>
(function(){
  var f=document.getElementById('f'),u=document.getElementById('url'),go=document.getElementById('go'),hint=document.getElementById('hint');
  f.addEventListener('submit',function(e){
    e.preventDefault();
    var v=(u.value||'').trim();
    if(!v) return;
    go.disabled=true;go.textContent='检测中…';
    hint.innerHTML='正在抓取并分析，通常 2–8 秒…';
    fetch('/v1/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:v})})
      .then(function(r){return r.json().then(function(j){return {s:r.status,j:j}})})
      .then(function(o){
        if(o.s===200 && o.j.ok && o.j.data.id){ location.href='/report/'+o.j.data.id; return; }
        if(o.s===401){ hint.innerHTML='<span style="color:#fca5a5">需要 API Token。请在 <a href="/docs">文档</a> 里创建一个，或在配置中设置 auth.mode=none。</span>'; }
        else if(o.s===429){ hint.innerHTML='<span style="color:#fca5a5">请求太频繁，稍后再试。</span>'; }
        else { hint.innerHTML='<span style="color:#fca5a5">'+((o.j.error&&o.j.error.message)||'检测失败')+'</span>'; }
        go.disabled=false;go.textContent='开始检测';
      })
      .catch(function(){ hint.innerHTML='<span style="color:#fca5a5">网络错误，请重试。</span>'; go.disabled=false;go.textContent='开始检测'; });
  });
})();
</script>`;
  return layout({
    title: '',
    description: '零依赖的网站 SEO 检测与评分 API：8 个维度 84 项检查，返回 0–100 分、问题清单与可复制的修复代码。',
    body, cfg, version,
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
  const body = `<style>${REPORT_CSS}${HOME_CSS}</style>
<h1>文档</h1>
<p class="lede">全部接口、请求格式与错误码。所有响应都是 JSON，除徽章接口返回 SVG。</p>

<div class="panel" style="margin-bottom:26px">
  <h3 style="margin-top:0">鉴权</h3>
  <p class="muted" style="margin:6px 0 10px">默认需要 Token。放在 <code>Authorization: Bearer &lt;token&gt;</code> 或 <code>X-API-Key</code> 头里。</p>
  <pre><code>curl -X POST ${esc(cfg.publicUrl)}/v1/analyze \\
  -H 'Authorization: Bearer s2a_xxx' \\
  -H 'content-type: application/json' \\
  -d '{"url":"example.com"}'</code></pre>
  <p class="muted" style="margin:10px 0 0">想内网无鉴权直接跑？设置 <code>SEO2API_AUTH_MODE=none</code>。</p>
</div>

<div class="toc">
  ${ENDPOINTS.map((e, i) => `<a href="#${e.id}">${esc(e.method)} ${esc(e.path.split('?')[0])}</a>`).join('')}
</div>

${ENDPOINTS.map((e) => `<section id="${e.id}" class="ep">
  <div class="ep-head"><span class="tag ${e.method === 'GET' ? 'info' : 'pass'}">${e.method}</span><code class="ep-path">${esc(e.path)}</code></div>
  <h3>${esc(e.title)}</h3>
  <p class="muted">${esc(e.desc)}</p>
  ${e.body ? `<div class="ep-label">请求</div><pre><code>${esc(e.body)}</code></pre>` : ''}
  ${e.resp ? (e.id === 'badge' ? `<div class="ep-label">用法</div><pre><code>&lt;img src="${esc(cfg.publicUrl)}/badge?url=example.com" alt="SEO"&gt;</code></pre>` : `<div class="ep-label">响应</div><pre><code>${esc(e.resp)}</code></pre>`) : ''}
</section>`).join('')}

<section id="errors">
  <h2>错误码</h2>
  <div class="panel">
    <div class="kv"><span class="k">400 bad_request</span><span class="v">参数不合法</span></div>
    <div class="kv"><span class="k">401 unauthorized</span><span class="v">Token 缺失或无效</span></div>
    <div class="kv"><span class="k">403 forbidden</span><span class="v">目标地址被安全策略拒绝（内网/黑名单）</span></div>
    <div class="kv"><span class="k">404 not_found</span><span class="v">报告或接口不存在</span></div>
    <div class="kv"><span class="k">429 rate_limited</span><span class="v">超出配额，看 <code>retry-after</code></span></div>
    <div class="kv"><span class="k">502 upstream_error</span><span class="v">目标站点连接失败或 DNS 错误</span></div>
    <div class="kv"><span class="k">504 upstream_timeout</span><span class="v">目标站点超时</span></div>
  </div>
</section>

<section>
  <h2>评分维度</h2>
  <div class="panel">
  ${dimensions.map((d) => `<div class="kv"><span class="k">${esc(d.name)} · ${(d.weight * 100).toFixed(0)}%</span><span class="v">${esc(d.desc)}</span></div>`).join('')}
  </div>
</section>`;
  return layout({ title: '文档', description: 'Seo2Api 全部 API 接口、请求格式、错误码与评分维度说明。', body, cfg, version, active: 'docs' });
}

export function renderNotFoundPage({ cfg }) {
  return layout({
    title: '页面不存在',
    body: `<div class="center" style="padding:80px 0">
      <h1>404</h1>
      <p class="muted">这份报告不存在，可能已被清理。</p>
      <p><a class="btn btn-ghost" href="/">回到首页重新检测</a></p>
    </div>`,
    cfg,
    version: '1.0.0',
  });
}
