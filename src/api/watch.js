import { badRequest, notFound } from '../util/errors.js';
import { normalizeTarget } from '../util/url.js';
import { analyzeUrl } from '../core/analyzer.js';
import { serializeReport } from '../core/serialize.js';
import { logger } from '../util/logger.js';

/**
 * 站点监控：定时巡检，分数变化时回调 webhook。
 * 这是"上线之后还能用"的关键——SEO 是持续过程，不是一次性检查。
 */
export function createWatchApi(cfg, store, ctx) {
  let timer = null;

  return {
    list() {
      return { total: store.listWatches().length, items: store.listWatches() };
    },

    create(body) {
      const url = normalizeTarget(body?.url).toString();
      const intervalMinutes = Math.min(Math.max(Number(body?.intervalMinutes) || 1440, 5), 43_200);
      const webhookUrl = body?.webhookUrl ? String(body.webhookUrl) : '';
      if (webhookUrl) {
        let u;
        try { u = new URL(webhookUrl); } catch { throw badRequest('webhookUrl 格式不正确'); }
        if (!/^https?:$/.test(u.protocol)) throw badRequest('webhookUrl 必须是 http/https');
      }
      if (store.listWatches().some((w) => w.url === url)) throw badRequest('该 URL 已在监控列表中');
      return store.createWatch({ url, label: String(body?.label || ''), intervalMinutes, webhookUrl });
    },

    remove(id) {
      if (!store.deleteWatch(Number(id))) throw notFound('监控项不存在');
      return { deleted: true };
    },

    toggle(id, enabled) {
      const w = store.toggleWatch(Number(id), enabled);
      if (!w) throw notFound('监控项不存在');
      return w;
    },

    /** 立即跑一次，不等调度 */
    async runNow(id) {
      const watch = store.getWatch(Number(id));
      if (!watch) throw notFound('监控项不存在');
      return this.execute(watch);
    },

    async execute(watch) {
      const started = Date.now();
      try {
        const report = await analyzeUrl(watch.url, cfg);
        const previousScore = watch.lastScore;
        const auditId = store.saveAudit({
          url: report.url,
          finalUrl: report.finalUrl,
          host: report.host,
          score: report.score,
          grade: report.grade,
          blocked: report.blocked,
          counts: report.summary,
          contentHash: report.contentHash,
          durationMs: report.durationMs,
          mode: 'watch',
          report: serializeReport(report),
        });
        store.updateWatchRun(watch.id, { score: report.score, status: 'ok', intervalMinutes: watch.intervalMinutes });
        ctx.metrics.incr('watch.run');
        if (watch.webhookUrl && previousScore !== null && previousScore !== undefined) {
          const delta = Math.round((report.score - previousScore) * 10) / 10;
          if (Math.abs(delta) >= 1) {
            await sendWebhook(watch, { report, auditId, delta, previousScore });
          }
        }
        logger.info(`[watch] ${watch.url} → ${report.score} (${Date.now() - started}ms)`);
        return { ok: true, auditId, score: report.score, delta: previousScore === null ? null : Math.round((report.score - previousScore) * 10) / 10 };
      } catch (err) {
        store.updateWatchRun(watch.id, { score: null, status: `error:${err.code || 'unknown'}`, intervalMinutes: watch.intervalMinutes });
        ctx.metrics.incr('watch.error');
        return { ok: false, error: { code: err.code || 'internal_error', message: err.message } };
      }
    },

    /** 启动调度循环：用 setTimeout 递归，避免 setInterval 在慢任务上堆积 */
    start() {
      if (timer) return;
      const tick = async () => {
        try {
          const due = store.dueWatches();
          for (const w of due) {
            await this.execute(w);
          }
        } catch (err) {
          logger.warn('[watch] 调度异常', err.message);
        }
        const next = store.dueWatches()[0];
        const delay = next ? Math.max(1000, Math.min(next.nextRunAt - Date.now(), 60_000)) : 60_000;
        timer = setTimeout(tick, delay);
        if (timer.unref) timer.unref();
      };
      timer = setTimeout(tick, 5000);
      if (timer.unref) timer.unref();
    },

    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

async function sendWebhook(watch, payload) {
  const body = JSON.stringify({
    event: 'score_changed',
    url: watch.url,
    label: watch.label,
    previousScore: payload.previousScore,
    score: payload.report.score,
    delta: payload.delta,
    grade: payload.report.grade,
    topIssues: (payload.report.priority || []).slice(0, 5).map((p) => p.title),
    reportId: payload.auditId,
    timestamp: new Date().toISOString(),
  });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(watch.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'Seo2API-Webhook/1.0' },
      body,
      signal: controller.signal,
    });
    if (!res.ok) logger.warn(`[watch] webhook 返回 ${res.status} ${watch.webhookUrl}`);
  } catch (err) {
    logger.warn(`[watch] webhook 失败 ${watch.webhookUrl}: ${err.message}`);
  } finally {
    clearTimeout(t);
  }
}
