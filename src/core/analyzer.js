import crypto from 'node:crypto';
import { fetchPage } from './fetcher.js';
import { fetchAuxiliary } from './aux.js';
import { buildPageModel } from './page.js';
import { evaluateRules, overallScore, prioritize, summarize, gradeOf } from './score.js';
import { AppError, badRequest } from '../util/errors.js';
import { normalizeTarget } from '../util/url.js';
import { logger } from '../util/logger.js';
import { DIMENSIONS } from '../rules/index.js';

export const ANALYZER_VERSION = '1.0.0';

/**
 * 单页完整分析。
 * 顺序：URL 校验 → 抓取主文档 → 并行抓辅助资源 → 建模 → 跑规则 → 评分
 */
export async function analyzeUrl(inputUrl, cfg, options = {}) {
  const started = process.hrtime.bigint();
  const target = normalizeTarget(inputUrl);
  const url = target.toString();

  const fetched = await fetchPage(url, cfg, {
    headers: options.headers,
    timeoutMs: options.timeoutMs,
  });

  if (options.skipAux) {
    // 快速模式：只做页面内检测
  }

  const page = buildPageModel(fetched, { targetUrl: url });
  const aux = options.skipAux ? null : await fetchAuxiliary(page, cfg);

  const ctx = { page, aux, cfg, response: fetched, url };
  const results = evaluateRules(ctx);
  const scored = overallScore(results);
  const dimensionsWithNames = Object.fromEntries(
    DIMENSIONS.map((d) => [d.key, { ...scored.dimensions[d.key], name: d.name }])
  );
  const priority = prioritize(results, dimensionsWithNames);
  const summary = summarize(scored.score, dimensionsWithNames, results, priority);
  const grade = gradeOf(scored.score);

  const contentHash = crypto.createHash('sha1')
    .update(page.title).update('|').update(page.html.slice(0, 200_000))
    .digest('hex');

  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);

  return {
    id: null,
    analyzerVersion: ANALYZER_VERSION,
    url,
    finalUrl: page.finalUrl,
    host: safeHost(page.finalUrl),
    analyzedAt: new Date().toISOString(),
    durationMs,
    score: scored.score,
    grade: grade.grade,
    gradeLabel: grade.label,
    gradeColor: grade.color,
    blocked: scored.blocked,
    scoringModel: {
      arithmetic: scored.arithmetic,
      geometric: scored.geometric,
      blend: '0.7 × 加权算术平均 + 0.3 × 加权几何平均',
      note: '几何平均用于惩罚短板维度；noindex 等致命项会强制压分',
    },
    summary,
    dimensions: Object.values(dimensionsWithNames),
    priority: priority.slice(0, 20),
    checks: results,
    page: summarizePage(page),
    aux: summarizeAux(aux),
    contentHash,
  };
}

function safeHost(u) {
  try { return new URL(u).host; } catch { return ''; }
}

/** 只保留对用户有价值的页面事实，不把整个 DOM 序列化出去 */
function summarizePage(page) {
  return {
    status: page.status,
    finalUrl: page.finalUrl,
    charset: page.charset,
    contentType: page.contentType,
    lang: page.lang,
    title: page.title,
    titleLength: page.titleLength,
    description: page.description,
    descriptionLength: page.descriptionLength,
    h1: page.h1s.map((h) => h.text),
    headingOutline: page.headings.slice(0, 40).map((h) => ({ level: h.level, text: h.text })),
    canonical: page.canonical,
    robotsMeta: page.robotsMeta,
    wordCount: page.wordCount,
    textHtmlRatio: Math.round(page.textHtmlRatio * 1000) / 1000,
    htmlBytes: page.htmlBytes,
    images: page.images.length,
    imagesWithoutAlt: page.imagesNoAlt.length,
    internalLinks: page.internalLinks.length,
    externalLinks: page.externalLinks.length,
    structuredTypes: page.structuredTypes,
    og: { title: page.og.title, image: page.og.image, type: page.og.type, locale: page.og.locale },
    twitterCard: page.twitter.card || null,
    favicons: page.favicons.length,
    redirects: page.redirects,
    htmlLang: page.lang,
    keywords: page.keywords.slice(0, 8),
    semantic: page.semantic,
    resourceHints: { preconnect: page.resourceHints.preconnect, dnsPrefetch: page.resourceHints.dnsPrefetch, preload: page.resourceHints.preload.length },
    securityHeaders: {
      hsts: Boolean(page.securityHeaders.hsts),
      csp: Boolean(page.securityHeaders.csp),
      xContentTypeOptions: page.securityHeaders.xContentTypeOptions || null,
      xFrameOptions: page.securityHeaders.xFrameOptions || null,
      referrerPolicy: page.securityHeaders.referrerPolicy || null,
    },
    server: page.negotiated.server || null,
    httpCache: {
      cacheControl: page.negotiated.cacheControl || null,
      etag: page.negotiated.etag,
      lastModified: page.negotiated.lastModified,
      contentEncoding: page.negotiated.contentEncoding || null,
    },
  };
}

function summarizeAux(aux) {
  if (!aux) return null;
  return {
    robots: aux.robots ? {
      exists: aux.robots.exists,
      url: aux.robotsUrl,
      ruleCount: aux.robots.rules.length,
      sitemaps: aux.robots.sitemaps,
      crawlDelay: aux.robots.crawlDelay,
      groups: aux.robots.groups.length,
    } : null,
    sitemap: aux.sitemap ? {
      url: aux.sitemapUrl,
      urlCount: aux.sitemap.entries.length,
      isIndex: aux.sitemap.isIndex,
      pageIncluded: aux.pageInSitemap,
    } : null,
    llmsTxt: aux.llmsTxt ? {
      url: aux.llmsUrl,
      title: aux.llmsTxt.title,
      summary: aux.llmsTxt.summary,
      sections: aux.llmsTxt.sections.length,
      links: aux.llmsTxt.linkCount,
      size: aux.llmsTxt.size,
    } : null,
    favicon: { reachable: aux.faviconReachable, url: aux.faviconUrl || null },
    httpsRedirect: aux.httpsRedirect,
    securityTxt: Boolean(aux.securityTxt),
  };
}

/**
 * 批量分析：并发执行，单个失败不影响其它。
 */
export async function analyzeBatch(urls, cfg, options = {}) {
  const list = Array.isArray(urls) ? urls : [];
  if (!list.length) throw badRequest('urls 不能为空');
  if (list.length > cfg.limits.batchMax) {
    throw badRequest(`单次批量最多 ${cfg.limits.batchMax} 个 URL，当前 ${list.length} 个`);
  }
  // 去重但保留顺序
  const seen = new Set();
  const unique = [];
  for (const u of list) {
    const key = String(u).trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(key);
  }

  const concurrency = Math.max(1, Math.min(options.concurrency || 3, unique.length));
  const results = new Array(unique.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < unique.length) {
      const idx = cursor++;
      const u = unique[idx];
      try {
        results[idx] = { ok: true, url: u, report: await analyzeUrl(u, cfg, options) };
      } catch (err) {
        results[idx] = {
          ok: false,
          url: u,
          error: err instanceof AppError ? err.toJSON() : { code: 'internal_error', message: String(err?.message || err) },
        };
        logger.debug('batch item failed', u, err?.message);
      }
    }
  });
  await Promise.all(workers);

  const ok = results.filter((r) => r.ok);
  const avg = ok.length ? ok.reduce((a, r) => a + r.report.score, 0) / ok.length : 0;
  return {
    total: results.length,
    succeeded: ok.length,
    failed: results.length - ok.length,
    averageScore: Math.round(avg * 10) / 10,
    results,
  };
}

/** 对比两次报告，输出分数与检查项变化 */
export function compareReports(before, after) {
  if (!before || !after) throw badRequest('对比需要两次有效的报告');
  const beforeChecks = new Map(before.checks.map((c) => [c.id, c]));
  const afterChecks = new Map(after.checks.map((c) => [c.id, c]));

  const fixed = [];
  const broken = [];
  const changed = [];
  for (const [id, a] of afterChecks) {
    const b = beforeChecks.get(id);
    if (!b) continue;
    if (b.status !== a.status) {
      if (isImprovement(b.status, a.status)) fixed.push({ id, title: a.title, from: b.status, to: a.status, dimension: a.dimension });
      else broken.push({ id, title: a.title, from: b.status, to: a.status, dimension: a.dimension });
      changed.push({ id, from: b.status, to: a.status });
    }
  }

  const dimDeltas = {};
  for (const d of after.dimensions) {
    const bd = before.dimensions.find((x) => x.key === d.key);
    dimDeltas[d.key] = {
      name: d.name,
      before: bd?.score ?? null,
      after: d.score,
      delta: bd ? Math.round((d.score - bd.score) * 10) / 10 : null,
    };
  }

  const delta = Math.round((after.score - before.score) * 10) / 10;
  return {
    before: { id: before.id, url: before.url, score: before.score, grade: before.grade, analyzedAt: before.analyzedAt },
    after: { id: after.id, url: after.url, score: after.score, grade: after.grade, analyzedAt: after.analyzedAt },
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    fixed: fixed.slice(0, 30),
    broken: broken.slice(0, 30),
    dimensions: dimDeltas,
    verdict: delta > 0
      ? `分数提升 ${delta} 分，修复了 ${fixed.length} 项，新增 ${broken.length} 项问题。`
      : delta < 0
        ? `分数下降 ${Math.abs(delta)} 分，新增 ${broken.length} 项问题。`
        : `分数持平，${fixed.length} 项改善、${broken.length} 项退步相互抵消。`,
  };
}

const STATUS_ORDER = { fail: 0, warn: 1, info: 2, skip: 3, pass: 4 };
const isImprovement = (from, to) => (STATUS_ORDER[to] ?? 0) > (STATUS_ORDER[from] ?? 0);
