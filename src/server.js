import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { Store } from './core/db.js';
import { Metrics } from './core/metrics.js';
import { logger } from './util/logger.js';
import { AppError, badRequest, notFound, tooMany } from './util/errors.js';
import { Router } from './http/router.js';
import { RateLimiter } from './http/ratelimit.js';
import { createAuth, requireAdmin, clientIp } from './http/auth.js';
import { sendJson, sendError, sendText, send } from './http/respond.js';
import { createAuditApi } from './api/audit.js';
import { createWatchApi } from './api/watch.js';
import { createBadgeApi } from './api/badge.js';
import { compactReport } from './core/serialize.js';
import { DIMENSIONS } from './rules/index.js';
import { renderReportPage, renderHomePage, renderDocsPage, renderNotFoundPage } from './ui/pages.js';
import { serveStatic } from './ui/static.js';
import { APP_CSS, APP_CSS_VERSION, HOME_JS, APP_JS_VERSION } from './ui/assets.js';

export const VERSION = '1.1.0';

export async function createServer(overrides = {}) {
  const cfg = loadConfig(overrides);
  logger.setLevel(cfg.logLevel);
  const store = new Store(cfg);
  const metrics = new Metrics();
  const limiter = new RateLimiter(cfg.rateLimit);
  const authenticate = createAuth(cfg, store);

  const ctx = { cfg, store, metrics, limiter };
  const auditApi = createAuditApi(cfg, store, ctx);
  const watchApi = createWatchApi(cfg, store, ctx);
  const badgeApi = createBadgeApi(cfg, store, ctx);

  const router = new Router();

  // ---------- 健康与元信息 ----------
  /** 页面统一的安全响应头：页面是服务端渲染的静态 HTML，内联脚本只有一个表单提交处理器 */
  const PAGE_HEADERS = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=300',
    'content-security-policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  };

  router.get('/', (req, res) => {
    send(req, res, 200, renderHomePage({ cfg, version: VERSION, dimensions: DIMENSIONS }), PAGE_HEADERS);
  });

  router.get('/docs', (req, res) => {
    send(req, res, 200, renderDocsPage({ cfg, version: VERSION, dimensions: DIMENSIONS }), PAGE_HEADERS);
  });

  router.get('/health', (req, res) => {
    const db = store.stats();
    sendJson(req, res, 200, {
      ok: db.integrity === 'ok',
      status: 'healthy',
      version: VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      database: { integrity: db.integrity, bytes: db.bytes, audits: db.audits },
      timestamp: new Date().toISOString(),
    }, { 'cache-control': 'no-store' });
  });

  router.get('/v1', (req, res) => {
    sendJson(req, res, 200, apiIndex(cfg, VERSION));
  });

  // ---------- 分析 ----------
  router.post('/v1/analyze', async (req, res, { body }) => {
    const report = await auditApi.analyze(body);
    const compact = body?.compact === true;
    sendJson(req, res, 200, {
      ok: true,
      cached: report.cached,
      data: compact ? compactReport(report) : report,
    });
  }, { auth: true });

  router.post('/v1/batch', async (req, res, { body }) => {
    assertJsonArray(body?.urls, 'urls');
    const result = await auditApi.batch(body);
    sendJson(req, res, 200, { ok: true, data: result });
  }, { auth: true });

  router.get('/v1/report/:id', (req, res, { params, query }) => {
    const audit = auditApi.get(params.id);
    if (query.get('format') === 'compact') return sendJson(req, res, 200, { ok: true, data: compactReport(audit.report) });
    sendJson(req, res, 200, { ok: true, data: audit });
  }, { auth: true });

  router.get('/v1/reports', (req, res, { query }) => {
    sendJson(req, res, 200, {
      ok: true,
      data: auditApi.list({ url: query.get('url'), host: query.get('host'), limit: query.get('limit'), offset: query.get('offset') }),
    });
  }, { auth: true });

  router.get('/v1/history', (req, res, { query }) => {
    sendJson(req, res, 200, { ok: true, data: auditApi.history(query.get('url'), { limit: query.get('limit') }) });
  }, { auth: true });

  router.get('/v1/compare', (req, res, { query }) => {
    const ids = query.get('ids') ? query.get('ids').split(',').map((s) => s.trim()).filter(Boolean) : null;
    sendJson(req, res, 200, { ok: true, data: auditApi.compare({ ids, url: query.get('url') }) });
  }, { auth: true });

  // ---------- 监控 ----------
  router.get('/v1/watches', (req, res) => {
    sendJson(req, res, 200, { ok: true, data: watchApi.list() });
  }, { auth: true });

  router.post('/v1/watches', async (req, res, { body }) => {
    sendJson(req, res, 201, { ok: true, data: watchApi.create(body) });
  }, { auth: true });

  router.delete('/v1/watches/:id', (req, res, { params }) => {
    sendJson(req, res, 200, { ok: true, data: watchApi.remove(params.id) });
  }, { auth: true });

  router.post('/v1/watches/:id/run', async (req, res, { params }) => {
    sendJson(req, res, 200, { ok: true, data: await watchApi.runNow(params.id) });
  }, { auth: true });

  // ---------- 徽章 ----------
  router.get('/badge', async (req, res, { query }) => {
    const url = query.get('url');
    if (!url) throw badRequest('缺少 url 参数，例如 /badge?url=example.com');
    const result = await badgeApi.forUrl(url, { style: query.get('style') || 'flat', label: query.get('label') || 'SEO' });
    if (result.error) return sendJson(req, res, 502, { ok: false, error: result });
    send(req, res, 200, result.svg, {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=600',
    });
  });

  // ---------- 管理 ----------
  router.get('/v1/admin/keys', (req, res) => {
    requireAdmin(req);
    sendJson(req, res, 200, { ok: true, data: { total: store.listKeys().length, items: store.listKeys() } });
  }, { auth: true });

  router.post('/v1/admin/keys', async (req, res, { body }) => {
    requireAdmin(req);
    if (!body?.name) throw badRequest('缺少 name 参数');
    const key = store.createKey({
      name: String(body.name).slice(0, 64),
      quotaPerMin: Math.min(Math.max(Number(body.quotaPerMin) || cfg.auth.defaultQuotaPerMin, 1), 100_000),
      note: String(body.note || '').slice(0, 200),
    });
    sendJson(req, res, 201, {
      ok: true,
      data: key,
      warning: '这是明文 key，只显示一次，请立刻保存。',
    });
  }, { auth: true });

  router.delete('/v1/admin/keys/:id', (req, res, { params }) => {
    requireAdmin(req);
    sendJson(req, res, 200, { ok: true, data: { deleted: store.deleteKey(Number(params.id)) } });
  }, { auth: true });

  router.post('/v1/admin/keys/:id/revoke', async (req, res, { params }) => {
    requireAdmin(req);
    sendJson(req, res, 200, { ok: true, data: { revoked: store.revokeKey(Number(params.id)) } });
  }, { auth: true });

  router.get('/v1/admin/stats', (req, res) => {
    requireAdmin(req);
    sendJson(req, res, 200, {
      ok: true,
      data: {
        version: VERSION,
        database: store.stats(),
        cache: auditApi.cacheStats(),
        rateLimiter: { buckets: limiter.size },
        usage: store.usageStats(),
        watches: watchApi.list().total,
      },
    });
  }, { auth: true });

  router.get('/v1/admin/backups', (req, res) => {
    requireAdmin(req);
    sendJson(req, res, 200, { ok: true, data: { items: store.listBackups() } });
  }, { auth: true });

  router.post('/v1/admin/backup', async (req, res) => {
    requireAdmin(req);
    const info = store.backup();
    sendJson(req, res, 201, { ok: true, data: info });
  }, { auth: true });

  router.post('/v1/admin/cache/clear', async (req, res) => {
    requireAdmin(req);
    auditApi.clearCache();
    sendJson(req, res, 200, { ok: true, data: { cleared: true } });
  }, { auth: true });

  router.get('/metrics', (req, res) => {
    const token = req.headers.authorization;
    if (cfg.auth.mode !== 'none') {
      const ok = token && cfg.auth.adminToken && token === `Bearer ${cfg.auth.adminToken}`;
      if (!ok) throw notFound('指标接口在启用鉴权时仅限管理员访问');
    }
    sendText(req, res, 200, metrics.prometheus(), { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
  });

  // ---------- HTML 报告页 ----------
  router.get('/report/:id', (req, res, { params }) => {
    const audit = store.getAudit(params.id);
    if (!audit) {
      return send(req, res, 404, renderNotFoundPage({ cfg, version: VERSION }), {
        ...PAGE_HEADERS,
        'cache-control': 'no-store',
      });
    }
    // 落库时还不知道自己的 id，读取时补回去，页面上的徽章/重检链接才指向对的目标
    if (audit.report && !audit.report.id) {
      audit.report.id = audit.id;
      audit.report.reportUrl = `${cfg.publicUrl}/report/${audit.id}`;
    }
    send(req, res, 200, renderReportPage({ report: audit.report, cfg, version: VERSION }), PAGE_HEADERS);
  });

  // ---------- 静态资源（CSS / JS 由代码生成，跟随版本号缓存） ----------
  const sendImmutable = (req, res, type, body, etag) => {
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end();
    }
    send(req, res, 200, body, {
      'content-type': type,
      'cache-control': 'public, max-age=31536000, immutable',
      etag,
    });
  };
  router.get('/assets/app.css', (req, res) => {
    sendImmutable(req, res, 'text/css; charset=utf-8', APP_CSS, `"css-${APP_CSS_VERSION}"`);
  });
  router.get('/assets/app.js', (req, res) => {
    sendImmutable(req, res, 'text/javascript; charset=utf-8', HOME_JS, `"js-${APP_JS_VERSION}"`);
  });

  // ---------- 静态资源 ----------
  router.get('/assets/*', async (req, res, { params }) => {
    await serveStatic(req, res, params.wildcard);
  });
  router.get('/icons/*', async (req, res, { params }) => {
    await serveStatic(req, res, 'icons/' + params.wildcard);
  });
  router.get('/favicon.ico', async (req, res) => {
    await serveStatic(req, res, 'favicon.ico');
  });
  router.get('/favicon.svg', async (req, res) => {
    await serveStatic(req, res, 'favicon.svg');
  });
  router.get('/apple-touch-icon.png', async (req, res) => {
    await serveStatic(req, res, 'icons/apple-touch-icon.png');
  });
  router.get('/site.webmanifest', async (req, res) => {
    await serveStatic(req, res, 'site.webmanifest');
  });
  router.get('/robots.txt', (req, res) => {
    sendText(req, res, 200, `User-agent: *\nAllow: /\nDisallow: /v1/\nDisallow: /report/\nDisallow: /metrics\n\nSitemap: ${cfg.publicUrl}/sitemap.xml\n`, {
      'cache-control': 'public, max-age=3600',
    });
  });
  router.get('/llms.txt', (req, res) => {
    sendText(req, res, 200, renderLlmsTxt(cfg, VERSION), { 'content-type': 'text/markdown; charset=utf-8' });
  });
  router.get('/sitemap.xml', (req, res) => {
    sendText(req, res, 200, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${cfg.publicUrl}/</loc><priority>1.0</priority><changefreq>weekly</changefreq></url>
  <url><loc>${cfg.publicUrl}/docs</loc><priority>0.8</priority><changefreq>weekly</changefreq></url>
</urlset>
`, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' });
  });

  // ---------- 请求处理主流程 ----------
  const server = http.createServer(async (req, res) => {
    const started = process.hrtime.bigint();
    const requestId = crypto.randomUUID();
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    res.setHeader('x-request-id', requestId);

    const finish = () => {
      const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
      metrics.recordHttp(routePath || pathname, res.statusCode, ms);
      const ip = clientIp(req);
      if (pathname.startsWith('/v1/')) {
        try {
          store.logUsage({
            keyId: req.auth?.id ?? null,
            ip,
            endpoint: `${req.method} ${routePath || pathname}`,
            status: res.statusCode,
            durationMs: ms,
          });
        } catch (err) {
          logger.debug('usage log failed', err.message);
        }
      }
    };
    res.on('finish', finish);

    let routePath = null;
    try {
      // CORS：允许浏览器直接调用（可被配置收紧）
      res.setHeader('access-control-allow-origin', cfg.cors?.origin || '*');
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-api-key');
      res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('access-control-expose-headers', 'x-request-id, x-ratelimit-remaining, retry-after');
      res.setHeader('x-frame-options', 'SAMEORIGIN');
      res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }

      const match = router.match(req.method, pathname);
      if (!match.route) {
        if (match.allow?.length) {
          throw new AppError('method_not_allowed', `${req.method} 不被支持`, 405, { allow: match.allow.join(', ') });
        }
        throw notFound(`未找到接口: ${pathname}`);
      }
      routePath = match.route.pattern;

      // 鉴权
      if (match.route.options.auth) authenticate(req);

      // 限流只作用于 API 与徽章：静态资源和页面不该被 API 配额卡住
      const limited = pathname.startsWith('/v1/') || pathname === '/badge' || pathname === '/metrics';
      const bucketKey = !limited || req.auth?.role === 'admin'
        ? null
        : (req.auth?.id ? `k:${req.auth.id}` : `ip:${clientIp(req)}`);
      if (bucketKey) {
        const limit = req.auth?.quotaPerMin && req.auth.quotaPerMin > 0 ? req.auth.quotaPerMin : cfg.rateLimit.max;
        const rl = limiter.take(bucketKey, limit);
        res.setHeader('x-ratelimit-limit', String(rl.limit));
        res.setHeader('x-ratelimit-remaining', String(rl.remaining));
        res.setHeader('x-ratelimit-reset', String(Math.ceil(rl.resetMs / 1000)));
        if (!rl.allowed) {
          metrics.incr('http.rate_limited');
          throw tooMany(`请求过于频繁，请在 ${Math.ceil(rl.resetMs / 1000)} 秒后重试`, Math.ceil(rl.resetMs / 1000));
        }
      }

      // 请求体解析
      let body = null;
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        body = await readJsonBody(req, cfg);
      }

      await match.route.handler(req, res, { params: match.params, query: url.searchParams, body, requestId });
    } catch (err) {
      if (!(err instanceof AppError)) {
        logger.error('未处理异常', err?.stack || err);
        metrics.incr('http.errors');
      } else if (err.status >= 500) {
        metrics.incr('http.upstream_errors');
      }
      if (!res.headersSent) {
        if (err?.closeConnection) res.setHeader('connection', 'close');
        sendError(req, res, err, requestId);
      } else {
        res.end();
      }
    }
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 120_000;

  return {
    server,
    cfg,
    store,
    metrics,
    auditApi,
    watchApi,
    badgeApi,
    async listen(port = cfg.port, host = cfg.host) {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address();
    },
    async close() {
      watchApi.stop();
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

const MAX_BODY = 1024 * 1024;

function readJsonBody(req, cfg) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > MAX_BODY) {
        aborted = true;
        chunks.length = 0;
        // 不能在这里 destroy：会连同响应一起断掉，客户端收不到 413。
        // 停止读取并让上层回包，随后由 connection: close 关闭连接。
        req.pause();
        const err = new AppError('payload_too_large', `请求体不能超过 ${MAX_BODY} 字节`, 413);
        err.closeConnection = true;
        reject(err);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      const ct = String(req.headers['content-type'] || '');
      if (ct && !/json/i.test(ct) && !/form-urlencoded/i.test(ct)) {
        return reject(new AppError('unsupported_media_type', 'Content-Type 必须是 application/json', 415));
      }
      if (/form-urlencoded/i.test(ct)) {
        return resolve(Object.fromEntries(new URLSearchParams(text)));
      }
      try {
        const parsed = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object') {
          return reject(badRequest('请求体必须是 JSON 对象'));
        }
        resolve(parsed);
      } catch {
        reject(badRequest('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function assertJsonArray(v, name) {
  if (!Array.isArray(v)) throw badRequest(`${name} 必须是数组`);
  if (!v.length) throw badRequest(`${name} 不能为空`);
  if (v.length > 100) throw badRequest(`${name} 最多 100 项`);
}

function apiIndex(cfg, version) {
  return {
    ok: true,
    name: 'Seo2Api',
    version,
    description: '网站 SEO 检测与评分 API：8 维度 84 项检查，零依赖部署',
    authMode: cfg.auth.mode,
    endpoints: [
      { method: 'POST', path: '/v1/analyze', desc: '分析单个 URL，返回完整报告', body: { url: 'https://example.com', fast: false, compact: false } },
      { method: 'POST', path: '/v1/batch', desc: '批量分析（最多 20 个）', body: { urls: ['https://a.com', 'https://b.com'] } },
      { method: 'GET', path: '/v1/report/:id', desc: '按 ID 取历史报告' },
      { method: 'GET', path: '/v1/reports', desc: '报告列表，支持 url/host/limit/offset' },
      { method: 'GET', path: '/v1/history?url=', desc: '同一 URL 的分数趋势' },
      { method: 'GET', path: '/v1/compare?ids=a,b', desc: '对比两次报告，输出修复/退步项' },
      { method: 'GET', path: '/badge?url=', desc: '生成 SVG 评分徽章' },
      { method: 'POST', path: '/v1/watches', desc: '创建定时监控' },
      { method: 'GET', path: '/v1/watches', desc: '监控列表' },
      { method: 'POST', path: '/v1/watches/:id/run', desc: '立即巡检一次' },
      { method: 'GET', path: '/health', desc: '健康检查' },
      { method: 'GET', path: '/metrics', desc: 'Prometheus 指标' },
      { method: 'GET', path: '/v1/admin/keys', desc: '管理 API Key（需 admin）' },
      { method: 'POST', path: '/v1/admin/backup', desc: '立即备份数据库（需 admin）' },
    ],
    dimensions: DIMENSIONS.map((d) => ({ key: d.key, name: d.name, weight: d.weight })),
    docs: `${cfg.publicUrl}/docs`,
  };
}

function renderLlmsTxt(cfg, version) {
  return `# Seo2Api

> 网站 SEO 检测与评分 API。一次请求返回 8 个维度共 84 项检查结果、0–100 评分、可复制的修复代码，以及历史趋势对比。零第三方依赖，单个 JSON 请求体，Lighthouse 之外的另一种选择。

## 核心能力
- [分析接口](${cfg.publicUrl}/docs#analyze): POST /v1/analyze，提交 URL 返回完整报告
- [批量分析](${cfg.publicUrl}/docs#batch): 一次最多 20 个 URL，并发抓取
- [趋势对比](${cfg.publicUrl}/docs#compare): 对比两次报告，列出修复项与退步项
- [评分徽章](${cfg.publicUrl}/docs#badge): 生成 SVG 徽章嵌入 README
- [站点监控](${cfg.publicUrl}/docs#watch): 定时巡检并在分数变化时回调 webhook

## 评分维度
${DIMENSIONS.map((d) => `- ${d.name}（权重 ${(d.weight * 100).toFixed(0)}%）：${d.desc}`).join('\n')}

## 技术说明
- 运行时：Node.js ≥ 22.13，零第三方依赖
- 存储：单文件 SQLite，备份即复制
- 版本：${version}
`;
}
