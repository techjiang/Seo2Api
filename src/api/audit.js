import { analyzeUrl, analyzeBatch, compareReports } from '../core/analyzer.js';
import { badRequest, notFound } from '../util/errors.js';
import { TtlCache, SingleFlight } from '../core/cache.js';
import { normalizeTarget } from '../util/url.js';
import { serializeReport } from '../core/serialize.js';

export function createAuditApi(cfg, store, ctx) {
  const cache = new TtlCache({ ttlMs: cfg.cache.ttlMs, maxEntries: cfg.cache.maxEntries });
  const flight = new SingleFlight();

  const runAnalysis = async (url, options = {}) => {
    const key = `${url}|${Boolean(options.skipAux)}`;
    if (!options.noCache) {
      const hit = cache.get(key);
      if (hit) return { report: hit, cached: true };
    }
    return flight.run(key, async () => {
      const report = await analyzeUrl(url, cfg, options);
      if (cfg.cache.contentHashReuse) {
        const reuse = store.latestByUrl(report.url);
        // 同一 URL 且内容哈希一致，说明页面没变，直接复用历史分数语义（仍然记录新快照）
        report.contentUnchanged = Boolean(reuse && reuse.contentHash === report.contentHash);
      }
      cache.set(key, report);
      ctx.metrics.incr('analysis.total');
      ctx.metrics.observe('analysis.duration_ms', report.durationMs);
      return { report, cached: false };
    });
  };

  return {
    cache,

    /** POST /v1/analyze */
    async analyze(body, options = {}) {
      const url = body?.url;
      if (!url) throw badRequest('缺少 url 参数，例如 {"url":"https://example.com"}');
      const target = normalizeTarget(url).toString();
      const { report, cached } = await runAnalysis(target, {
        skipAux: body.fast === true,
        noCache: options.noCache,
      });

      let id = null;
      if (options.persist !== false) {
        id = store.saveAudit({
          url: report.url,
          finalUrl: report.finalUrl,
          host: report.host,
          score: report.score,
          grade: report.grade,
          blocked: report.blocked,
          counts: report.summary,
          contentHash: report.contentHash,
          durationMs: report.durationMs,
          mode: 'single',
          report: serializeReport(report),
        });
        report.id = id;
        report.reportUrl = `${cfg.publicUrl}/report/${id}`;
      }
      if (cached) ctx.metrics.incr('analysis.cache_hit');
      return { ...report, cached };
    },

    /** POST /v1/batch */
    async batch(body) {
      const urls = body?.urls;
      if (!Array.isArray(urls) || urls.length === 0) throw badRequest('urls 必须是非空数组');
      const result = await analyzeBatch(urls, cfg, { skipAux: body.fast === true });
      for (const item of result.results) {
        if (!item.ok) continue;
        item.report.id = store.saveAudit({
          url: item.report.url,
          finalUrl: item.report.finalUrl,
          host: item.report.host,
          score: item.report.score,
          grade: item.report.grade,
          blocked: item.report.blocked,
          counts: item.report.summary,
          contentHash: item.report.contentHash,
          durationMs: item.report.durationMs,
          mode: 'batch',
          report: serializeReport(item.report),
        });
        delete item.report.checks;
        delete item.report.priority;
      }
      return result;
    },

    get(id) {
      const audit = store.getAudit(id);
      if (!audit) throw notFound(`报告不存在: ${id}`);
      // 落库时还不知道自己的 id，读取时补回去，保证对外报告自洽
      if (audit.report) {
        audit.report.id = audit.id;
        audit.report.reportUrl = `${cfg.publicUrl}/report/${audit.id}`;
      }
      return audit;
    },

    list({ url, host, limit = 20, offset = 0 }) {
      const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
      const off = Math.max(Number(offset) || 0, 0);
      return store.listAudits({ url, host, limit: lim, offset: off });
    },

    history(url, { limit = 30 } = {}) {
      if (!url) throw badRequest('缺少 url 参数');
      const target = normalizeTarget(url).toString();
      const items = store.history(target, Math.min(Number(limit) || 30, cfg.limits.historyMax));
      const trend = items.length >= 2 ? items[0].score - items[1].score : 0;
      return {
        url: target,
        total: items.length,
        latest: items[0] || null,
        trend: Math.round(trend * 10) / 10,
        direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat',
        items,
      };
    },

    /** GET/POST /v1/compare?id=a&id=b 或 ?url=x */
    compare({ ids, url }) {
      if (ids && ids.length === 2) {
        const [a, b] = ids.map((id) => store.getAudit(id));
        if (!a || !b) throw notFound('对比的报告不存在');
        return compareReports(a.report, b.report);
      }
      if (url) {
        const target = normalizeTarget(url).toString();
        const items = store.history(target, 2);
        if (items.length < 2) throw notFound('该 URL 的历史记录不足两次，无法对比');
        const [latest, previous] = items.map((i) => store.getAudit(i.id));
        return compareReports(previous.report, latest.report);
      }
      throw badRequest('需要提供 ids=a,b 或 url 参数');
    },

    clearCache() {
      cache.clear();
      return true;
    },

    cacheStats() {
      return { ...cache.stats(), inFlight: flight.size };
    },
  };
}
