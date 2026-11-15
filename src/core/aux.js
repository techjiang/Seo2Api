import { fetchPage } from './fetcher.js';
import { AppError } from '../util/errors.js';
import { originOf } from '../util/url.js';

/** robots.txt 解析：支持 User-agent 分组、Allow/Disallow、Sitemap */
export function parseRobotsTxt(text, userAgent = '*') {
  const lines = String(text || '').split(/\r?\n/);
  const groups = [];
  let current = null;
  const sitemaps = [];
  let crawlDelay = null;
  let started = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || started) {
        current = { agents: [], rules: [] };
        groups.push(current);
        started = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (field === 'sitemap') { sitemaps.push(value); continue; }
    if (!current) continue;
    started = true;
    if (field === 'allow' || field === 'disallow') {
      // 空 Disallow 表示允许全部
      if (field === 'disallow' && value === '') continue;
      current.rules.push({ type: field, path: value });
    } else if (field === 'crawl-delay') {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) crawlDelay = n;
    }
  }

  const uaLower = String(userAgent).toLowerCase();
  const matching = groups.filter((g) => g.agents.some((a) => a === '*' || uaLower.includes(a)));
  // 更具体的 UA 分组优先
  matching.sort((a, b) => {
    const sa = Math.max(...a.agents.map((x) => (x === '*' ? 0 : x.length)));
    const sb = Math.max(...b.agents.map((x) => (x === '*' ? 0 : x.length)));
    return sb - sa;
  });
  const effective = matching[0] || null;

  return {
    exists: String(text || '').trim().length > 0,
    groups,
    sitemaps,
    crawlDelay,
    matchedGroup: effective,
    rules: effective?.rules || [],
    userAgents: [...new Set(groups.flatMap((g) => g.agents))],
  };
}

/**
 * 判断路径是否被 robots 允许。遵循最长匹配优先（Google 语义）。
 */
export function isPathAllowed(robots, pathname, search = '') {
  const path = `${pathname}${search}` || '/';
  const rules = robots?.rules || [];
  let best = null;
  for (const rule of rules) {
    const pattern = rule.path;
    if (!pattern) continue;
    const normalized = pattern.endsWith('$') ? pattern.slice(0, -1) : pattern;
    const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = new RegExp(`^${escaped}${pattern.endsWith('$') ? '$' : ''}`);
    if (re.test(path)) {
      const len = normalized.length;
      if (!best || len > best.len || (len === best.len && rule.type === 'allow')) {
        best = { len, type: rule.type };
      }
    }
  }
  return best ? best.type === 'allow' : true;
}

/** 解析 sitemap.xml，返回 url 列表（支持 sitemapindex 一层展开） */
export function parseSitemap(xml, { limit = 500 } = {}) {
  const entries = [];
  const urls = [];
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locRe = /<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi;
  let m;
  while ((m = locRe.exec(xml)) && entries.length < limit) {
    const loc = m[1].trim();
    if (loc) entries.push(loc);
  }
  const lastmodRe = /<lastmod>\s*([\s\S]*?)\s*<\/lastmod>/gi;
  const lastmods = [];
  while ((m = lastmodRe.exec(xml)) && lastmods.length < limit) lastmods.push(m[1].trim());
  return { isIndex, entries, lastmods, truncated: entries.length >= limit };
}

const safeFetch = async (url, cfg, opts = {}) => {
  try {
    const res = await fetchPage(url, cfg, { timeoutMs: opts.timeoutMs ?? 8000, maxBytes: opts.maxBytes ?? 1024 * 1024 });
    return { ...res, ok: res.status >= 200 && res.status < 300 };
  } catch (err) {
    return { error: err instanceof AppError ? err.toJSON() : { code: 'upstream_error', message: String(err?.message || err) }, ok: false };
  }
};

/**
 * 抓取站点级辅助资源：robots.txt、sitemap.xml、llms.txt、favicon、https 重定向。
 * 任何一个失败都不影响主流程。
 */
export async function fetchAuxiliary(page, cfg) {
  const origin = originOf(page.finalUrl);
  const out = {
    robots: null,
    robotsRaw: '',
    sitemap: null,
    sitemapUrl: '',
    llmsTxt: null,
    llmsFullTxt: null,
    faviconReachable: null,
    httpsRedirect: null,
    securityTxt: null,
    adsTxt: false,
  };
  if (!cfg.fetch.fetchAuxiliary) return out;

  // 全部并行发起：机器人协议 → sitemap 有依赖，但不必等其它请求
  const robotsJob = (async () => {
    const res = await safeFetch(`${origin}/robots.txt`, cfg);
    if (res.ok) {
      out.robotsRaw = res.html;
      out.robots = parseRobotsTxt(res.html, cfg.fetch.userAgent);
      out.robotsUrl = `${origin}/robots.txt`;
      out.robotsSize = Buffer.byteLength(res.html, 'utf8');
    } else {
      out.robotsStatus = res.status || res.error?.code || 'error';
    }
    // robots 里的 Sitemap 可能是相对路径，需补全为绝对地址
    const declared = out.robots?.sitemaps?.[0];
    if (declared) {
      try { return new URL(declared, origin).toString(); } catch { /* 落到默认 */ }
    }
    return `${origin}/sitemap.xml`;
  })().then(async (sitemapUrl) => {
    const sm = await safeFetch(sitemapUrl, cfg, { maxBytes: 2 * 1024 * 1024, timeoutMs: 9000 });
    if (sm.ok && (!sm.contentType || /xml|text|plain|octet/i.test(sm.contentType))) {
      const parsed = parseSitemap(sm.html);
      out.sitemap = parsed;
      out.sitemapUrl = sitemapUrl;
      out.sitemapUrlCount = parsed.entries.length;
      out.pageInSitemap = parsed.isIndex ? null : parsed.entries.some((u) => normalize(u) === normalize(page.finalUrl));
    } else {
      out.sitemapStatus = sm.status || sm.error?.code || 'error';
    }
  });

  const llmsJob = (async () => {
    const [short, full] = await Promise.all([
      safeFetch(`${origin}/llms.txt`, cfg),
      safeFetch(`${origin}/llms-full.txt`, cfg),
    ]);
    if (short.ok && !/<html[\s>]/i.test(short.html) && short.html.trim()) {
      out.llmsTxt = parseLlmsTxt(short.html);
      out.llmsUrl = `${origin}/llms.txt`;
    }
    if (full.ok && !/<html[\s>]/i.test(full.html) && full.html.trim()) {
      out.llmsFullTxt = { size: Buffer.byteLength(full.html, 'utf8') };
    }
  })();

  const securityJob = (async () => {
    const res = await safeFetch(`${origin}/.well-known/security.txt`, cfg);
    if (res.ok && /Contact\s*:/i.test(res.html || '')) out.securityTxt = `${origin}/.well-known/security.txt`;
  })();

  const faviconJob = (async () => {
    if (page.status < 200 || page.status >= 300) return;
    const icon = page.favicons[0]?.href || `${origin}/favicon.ico`;
    const res = await safeFetch(icon, cfg, { maxBytes: 512 * 1024, timeoutMs: 6000 });
    out.faviconReachable = Boolean(res.ok);
    out.faviconStatus = res.status || res.error?.code;
    out.faviconUrl = icon;
    out.faviconBytes = res.bytes || 0;
  })();

  const httpsJob = checkHttpsRedirect(page, cfg).then((r) => { out.httpsRedirect = r; });

  await Promise.all([robotsJob, llmsJob, securityJob, faviconJob, httpsJob]);
  return out;
}

const normalize = (u) => {
  try {
    const url = new URL(u);
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '') || '/'}`;
  } catch { return u; }
};

/** 检查 http → https 是否 301 跳转，以及是否强制单一主机名 */
async function checkHttpsRedirect(page, cfg) {
  let target = null;
  try {
    const u = new URL(page.finalUrl);
    if (u.protocol !== 'https:') {
      return { https: false, redirectsToHttps: false, note: '站点未使用 HTTPS' };
    }
    target = `http://${u.host}${u.pathname === '/' ? '/' : u.pathname}`;
  } catch {
    return null;
  }
  try {
    const res = await fetchPage(target, cfg, { maxRedirects: 1, timeoutMs: 7000, maxBytes: 64 * 1024 });
    const first = res.redirects?.[0];
    const finalHttps = res.finalUrl?.startsWith('https:');
    return {
      https: true,
      redirectsToHttps: Boolean(first && finalHttps),
      firstStatus: res.status,
      finalUrl: res.finalUrl,
      hsts: true,
    };
  } catch (err) {
    return { https: true, redirectsToHttps: null, note: err.code || 'error' };
  }
}

/** 解析 llms.txt 结构：H1 标题、blockquote 摘要、H2 分组、链接条目 */
export function parseLlmsTxt(text) {
  const lines = String(text || '').split(/\r?\n/);
  const title = (lines.find((l) => /^#\s+/.test(l)) || '').replace(/^#\s+/, '').trim();
  const summary = lines.filter((l) => /^>\s?/.test(l)).map((l) => l.replace(/^>\s?/, '').trim()).join(' ').trim();
  const sections = [];
  let current = null;
  let linkCount = 0;
  for (const line of lines) {
    const h2 = /^##\s+(.+)$/.exec(line.trim());
    if (h2) { current = { heading: h2[1].trim(), items: [] }; sections.push(current); continue; }
    const item = /^-\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.*))?/.exec(line.trim());
    if (item) {
      linkCount++;
      const entry = { title: item[1].trim(), url: item[2].trim(), note: (item[3] || '').trim() };
      if (current) current.items.push(entry);
    }
  }
  return { title, summary, sections, linkCount, size: Buffer.byteLength(text, 'utf8'), raw: text.slice(0, 4000) };
}
