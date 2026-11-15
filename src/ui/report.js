import { layout, esc } from './layout.js';
import { REPORT_CSS } from './report-css.js';

const STATUS_LABEL = { pass: '通过', warn: '警告', fail: '失败', info: '信息', skip: '跳过' };
const STATUS_COLOR = { pass: '#22c55e', warn: '#eab308', fail: '#ef4444', info: '#38bdf8', skip: '#64748b' };
const SEVERITY_LABEL = { critical: '致命', major: '重要', minor: '次要' };
const DIM_ICON = {
  content: 'M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z',
  technical: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  performance: 'M13 2 3 14h7l-1 8 10-12h-7z',
  discoverability: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2-4.35-4.35',
  social: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  accessibility: 'M12 4a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-1 16v-5H6v-2h12v2h-5v5z',
  security: 'M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5z',
  ai: 'M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};

const fmtNum = (n) => (typeof n === 'number' ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '—');
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const scoreColor = (s) => (s >= 88 ? '#22c55e' : s >= 78 ? '#84cc16' : s >= 65 ? '#eab308' : s >= 50 ? '#f97316' : '#ef4444');

/* 评分环 */
function scoreRing(score, grade, color) {
  const r = 66;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `<div class="ring">
    <svg width="158" height="158" viewBox="0 0 158 158" role="img" aria-label="总分 ${score} 分，等级 ${esc(grade)}">
      <circle cx="79" cy="79" r="${r}" fill="none" stroke="#1e2a38" stroke-width="11"/>
      <circle cx="79" cy="79" r="${r}" fill="none" stroke="${color}" stroke-width="11"
        stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
    </svg>
    <div class="val"><div class="num" style="color:${color}">${fmtNum(score)}</div><div class="grd" style="color:${color}">${esc(grade)}</div></div>
  </div>`;
}

/* 雷达图：8 维度 */
function radarChart(dimensions) {
  const size = 460;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 128;
  const n = dimensions.length;
  if (!n) return '';
  const pt = (i, ratio) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [cx + Math.cos(angle) * maxR * ratio, cy + Math.sin(angle) * maxR * ratio];
  };
  const rings = [0.25, 0.5, 0.75, 1].map((ratio) => {
    const pts = dimensions.map((_, i) => pt(i, ratio).map((v) => v.toFixed(1)).join(',')).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="#1e2a38" stroke-width="1"/>`;
  }).join('');
  const spokes = dimensions.map((_, i) => {
    const [x, y] = pt(i, 1);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1e2a38" stroke-width="1"/>`;
  }).join('');
  const poly = dimensions.map((d, i) => pt(i, Math.max(0.02, d.score / 100)).map((v) => v.toFixed(1)).join(',')).join(' ');
  // 标签放在外圈之外，按象限决定对齐方式与竖直偏移，避免相邻标签压在一起
  const labels = dimensions.map((d, i) => {
    const [x, y] = pt(i, 1.16);
    const anchor = Math.abs(x - cx) < 14 ? 'middle' : x > cx ? 'start' : 'end';
    const above = y < cy - 10;
    const dy1 = above ? -8 : 14;
    const dy2 = above ? 6 : 28;
    return `<text x="${x.toFixed(1)}" y="${(y + dy1).toFixed(1)}" fill="#a7b6c4" font-size="13" text-anchor="${anchor}" font-family="var(--sans)">${esc(d.name)}</text>
      <text x="${x.toFixed(1)}" y="${(y + dy2).toFixed(1)}" fill="${scoreColor(d.score)}" font-size="12" font-weight="700" text-anchor="${anchor}" font-family="monospace">${fmtNum(d.score)}</text>`;
  }).join('');
  const dots = dimensions.map((d, i) => {
    const [x, y] = pt(i, Math.max(0.02, d.score / 100));
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${scoreColor(d.score)}"/>`;
  }).join('');

  return `<div class="radar-wrap">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="8 个维度得分雷达图">
      ${rings}${spokes}
      <polygon points="${poly}" fill="rgba(34,211,165,.16)" stroke="#22d3a5" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${labels}
    </svg>
  </div>`;
}

function dimensionCards(dimensions) {
  return `<div class="dims">${dimensions.map((d) => {
    const c = scoreColor(d.score);
    const counts = d.counts || {};
    return `<div class="dim-card">
      <div class="top">
        <span class="nm"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" style="vertical-align:-1px;margin-right:5px"><path d="${DIM_ICON[d.key] || DIM_ICON.content}"/></svg>${esc(d.name)}</span>
        <span class="sc" style="color:${c}">${fmtNum(d.score)}</span>
      </div>
      <div class="bar"><i style="width:${Math.max(2, d.score)}%;background:${c}"></i></div>
      <div class="sub">
        <span class="cnt"><i class="dot" style="background:#22c55e"></i>${counts.pass || 0} 通过</span>
        <span class="cnt"><i class="dot" style="background:#eab308"></i>${counts.warn || 0} 警告</span>
        <span class="cnt"><i class="dot" style="background:#ef4444"></i>${counts.fail || 0} 失败</span>
        <span class="wt">权重 ${((d.weight || 0) * 100).toFixed(0)}%</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function priorityList(priority) {
  if (!priority?.length) {
    return `<div class="card"><p class="muted" style="margin:0">没有需要修复的问题，页面状态很好。</p></div>`;
  }
  return `<ul class="prio">${priority.map((p) => `<li class="sev-${esc(p.severity)}">
    <div class="pt">
      <span class="tag ${p.status}">${STATUS_LABEL[p.status] || p.status}</span>
      <h3>${esc(p.title)}</h3>
      <span class="sev">${SEVERITY_LABEL[p.severity] || p.severity}</span>
      <span class="gain">预计 +${fmtNum(p.estimatedGain)} 分</span>
    </div>
    <p class="msg">${esc(p.message)}</p>
    ${p.fix ? `<pre><code>${esc(p.fix.code)}</code></pre>` : ''}
  </li>`).join('')}</ul>`;
}

function checksByDimension(dimensions, checks) {
  return dimensions.map((d, idx) => {
    const list = checks.filter((c) => c.dimension === d.key);
    if (!list.length) return '';
    const fails = list.filter((c) => c.status === 'fail').length;
    const warns = list.filter((c) => c.status === 'warn').length;
    const summaryTag = fails
      ? `<span class="tag fail">${fails} 项失败</span>`
      : warns ? `<span class="tag warn">${warns} 项警告</span>` : `<span class="tag pass">全部通过</span>`;
    return `<details class="chk"${idx === 0 ? ' open' : ''}>
      <summary>
        <span class="ct">${esc(d.name)}</span>
        ${summaryTag}
        <span class="dim">${list.length} 项 · 权重 ${((d.weight || 0) * 100).toFixed(0)}%</span>
      </summary>
      <div style="margin-top:12px;display:flex;flex-direction:column;gap:1px;background:var(--line-soft);border-radius:9px;overflow:hidden">
        ${list.map((c) => `<details class="chk" style="background:var(--panel-2)">
          <summary>
            <span class="tag ${c.status}">${STATUS_LABEL[c.status] || c.status}</span>
            <span class="ct" style="font-size:13.5px">${esc(c.title)}</span>
            <span class="sev">${SEVERITY_LABEL[c.severity] || c.severity}</span>
          </summary>
          <p class="cm">${esc(c.message)}</p>
          ${c.description ? `<p class="cd">为什么重要：${esc(c.description)}</p>` : ''}
          ${c.details?.length ? `<p class="cd">详情：${c.details.map((x) => esc(x)).join('；')}</p>` : ''}
          ${c.fix ? `<pre><code>${esc(c.fix.code)}</code></pre>` : ''}
        </details>`).join('')}
      </div>
    </details>`;
  }).join('');
}

function factsPanel(page, aux) {
  if (!page) return '';
  const row = (k, v) => `<div class="kv"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  const yesNo = (v) => (v ? '✓ 是' : '✗ 否');
  return `<div class="facts">
    <div class="fact"><h3>页面内容</h3>
      ${row('Title', page.title || '缺失')}
      ${row('Title 长度', String(page.titleLength || 0))}
      ${row('Description', page.description ? `${page.descriptionLength} 字符` : '缺失')}
      ${row('H1', page.h1?.length ? page.h1[0].slice(0, 40) : '无')}
      ${row('正文字数', String(page.wordCount || 0))}
      ${row('文本/HTML', `${((page.textHtmlRatio || 0) * 100).toFixed(1)}%`)}
      ${row('语言', page.lang || '未声明')}
    </div>
    <div class="fact"><h3>技术概况</h3>
      ${row('HTTP 状态', String(page.status))}
      ${row('HTML 体积', `${((page.htmlBytes || 0) / 1024).toFixed(1)} KB`)}
      ${row('Canonical', page.canonical ? '已设置' : '缺失')}
      ${row('robots meta', page.robotsMeta || '无限制')}
      ${row('结构化类型', page.structuredTypes?.length ? page.structuredTypes.slice(0, 3).join(', ') : '无')}
      ${row('重定向', String(page.redirects?.length || 0))}
      ${row('服务器', page.server || '隐藏')}
    </div>
    <div class="fact"><h3>资源与链接</h3>
      ${row('图片', `${page.images || 0} 张（${page.imagesWithoutAlt || 0} 缺 alt）`)}
      ${row('内链', String(page.internalLinks || 0))}
      ${row('外链', String(page.externalLinks || 0))}
      ${row('OG 图片', page.og?.image ? '有' : '无')}
      ${row('Twitter Card', page.twitterCard || '无')}
      ${row('压缩', page.httpCache?.contentEncoding || '未压缩')}
      ${row('缓存头', page.httpCache?.cacheControl ? '已设置' : '未设置')}
    </div>
    <div class="fact"><h3>站点级</h3>
      ${row('robots.txt', aux?.robots?.exists ? `${aux.robots.ruleCount} 条规则` : '未找到')}
      ${row('Sitemap', aux?.sitemap ? `${aux.sitemap.urlCount} 个 URL` : '未找到')}
      ${row('llms.txt', aux?.llmsTxt ? `${aux.llmsTxt.links} 个条目` : '未提供')}
      ${row('favicon', aux?.favicon?.reachable ? '可访问' : '不可访问')}
      ${row('HTTP→HTTPS', aux?.httpsRedirect?.redirectsToHttps ? '已跳转' : aux?.httpsRedirect?.redirectsToHttps === false ? '未跳转' : '未检测')}
      ${row('security.txt', aux?.securityTxt ? '已配置' : '未配置')}
      ${row('HSTS', page.securityHeaders?.hsts ? '已启用' : '未启用')}
    </div>
  </div>`;
}

export function renderReportPage({ report, cfg, version }) {
  const dims = report.dimensions || [];
  const checks = report.checks || [];
  const color = report.gradeColor || scoreColor(report.score);
  const s = report.summary || {};
  const badgeUrl = `/badge?url=${encodeURIComponent(report.finalUrl || report.url)}`;

  const body = `<style>${REPORT_CSS}</style>
<div class="score-hero" style="--glow:${color}22">
  ${scoreRing(report.score, report.grade, color)}
  <div class="score-meta">
    <h1>${esc(report.gradeLabel || '检测报告')} · ${fmtNum(report.score)} 分</h1>
    <div class="url">${esc(report.finalUrl || report.url)}</div>
    <p class="headline">${esc(s.headline || '')}</p>
    <div class="pills">
      ${s.criticalCount ? `<span class="tag fail">${s.criticalCount} 个致命问题</span>` : ''}
      <span class="tag fail">${s.failCount || 0} 失败</span>
      <span class="tag warn">${s.warnCount || 0} 警告</span>
      <span class="tag pass">${s.passCount || 0} 通过</span>
      <span class="tag skip">${report.durationMs || 0} ms</span>
      <span class="tag skip">${esc(fmtTime(report.analyzedAt))}</span>
    </div>
  </div>
</div>

${s.lines?.length > 1 ? `<div class="panel" style="margin-bottom:18px">
  ${s.lines.slice(1).map((l) => `<p class="muted" style="margin:0 0 6px;font-size:13.5px">· ${esc(l)}</p>`).join('')}
</div>` : ''}

<h2>维度得分</h2>
${dimensionCards(dims)}
${radarChart(dims)}

<h2>优先修复顺序</h2>
<p class="muted" style="margin:-6px 0 14px;font-size:13.5px">按「影响 ÷ 工作量」排序——从上往下改，性价比最高。</p>
${priorityList(report.priority)}

<h2>页面事实</h2>
${factsPanel(report.page, report.aux)}

<h2>全部检查项</h2>
<div class="checks">${checksByDimension(dims, checks)}</div>

<h2>分享与徽章</h2>
<div class="panel">
  <div class="badge-preview">
    <img src="${esc(badgeUrl)}" alt="SEO 评分徽章" height="20">
    <code style="font-size:12px">![SEO](${esc(cfg.publicUrl)}${esc(badgeUrl)})</code>
  </div>
  <p class="note">把徽章嵌进 README，每次访问都会自动更新分数（10 分钟缓存）。</p>
  <div class="row" style="margin-top:14px">
    <a class="btn btn-ghost" href="/?url=${encodeURIComponent(report.finalUrl || report.url)}">重新检测</a>
    <a class="btn btn-ghost" href="/v1/history?url=${encodeURIComponent(report.url)}">查看历史</a>
    <a class="btn btn-ghost" href="/v1/report/${esc(report.id || '')}?format=compact">JSON 摘要</a>
  </div>
  <p class="note">分析器版本 ${esc(report.analyzerVersion || version)} · 内容指纹 <code>${esc((report.contentHash || '').slice(0, 12))}</code></p>
</div>`;

  return layout({
    title: `${report.grade} · ${fmtNum(report.score)} 分 · ${report.host || ''}`,
    description: `${report.finalUrl} 的 SEO 检测结果：总分 ${fmtNum(report.score)}，等级 ${report.grade}。`,
    body, cfg, version,
  });
}
