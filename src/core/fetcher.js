import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { assertHostAllowed } from './netguard.js';
import { AppError } from '../util/errors.js';
import { logger } from '../util/logger.js';

const ACCEPT_ENCODING = typeof zlib.zstdDecompressSync === 'function'
  ? 'br, gzip, deflate, zstd'
  : 'br, gzip, deflate';

function decompress(buf, encoding) {
  const enc = String(encoding || '').toLowerCase().trim();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf, { maxOutputLength: 32 * 1024 * 1024 });
    if (enc.includes('zstd') && zlib.zstdDecompressSync) return zlib.zstdDecompressSync(buf, { maxOutputLength: 32 * 1024 * 1024 });
    if (enc.includes('gzip') || enc.includes('deflate')) return zlib.gunzipSync(buf, { maxOutputLength: 32 * 1024 * 1024 });
  } catch {
    return null;
  }
  return buf;
}

/**
 * 抓取单个 URL。刻意用 node:http(s) 而非 fetch：
 *  - 可以按已校验 IP 连接（防 DNS 重绑定）
 *  - 精确控制超时、字节上限、不自动跟随重定向（每跳都要重新做 SSRF 校验）
 */
export function requestOnce(targetUrl, options = {}) {
  const {
    timeoutMs = 12_000,
    headers = {},
    maxBytes = 4 * 1024 * 1024,
    lookup = undefined,
    method = 'GET',
  } = options;

  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const started = process.hrtime.bigint();
    let settled = false;

    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      fn(v);
    };

    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        servername: url.protocol === 'https:' && !url.hostname.startsWith('[') ? url.hostname : undefined,
        headers: {
          'user-agent': options.userAgent || 'Seo2Api/1.0',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'accept-encoding': ACCEPT_ENCODING,
          connection: 'close',
          ...headers,
        },
        lookup,
        agent: false,
        // 不校验站点证书会带来安全问题；保持默认严格校验
        rejectUnauthorized: true,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        let aborted = false;
        res.on('data', (chunk) => {
          if (aborted) return;
          size += chunk.length;
          if (size > maxBytes) {
            aborted = true;
            res.destroy();
            done(resolve, { truncated: true, tooLarge: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), ms: elapsed(started) });
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (aborted) return;
          const raw = Buffer.concat(chunks);
          const decoded = decompress(raw, res.headers['content-encoding']) ?? raw;
          done(resolve, {
            status: res.statusCode,
            headers: res.headers,
            body: decoded,
            bytes: raw.length,
            decodedBytes: decoded.length,
            ms: elapsed(started),
            truncated: false,
          });
        });
        res.on('error', (err) => done(reject, new AppError('upstream_error', `读取响应失败: ${err.message}`, 502)));
      }
    );

    const hardTimer = setTimeout(() => {
      req.destroy();
      done(reject, new AppError('upstream_timeout', `请求超时（${timeoutMs}ms）`, 504));
    }, timeoutMs);

    req.on('error', (err) => {
      const code = err.code || '';
      if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
        return done(reject, new AppError('upstream_timeout', '连接超时', 504));
      }
      if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
        return done(reject, new AppError('dns_error', `域名无法解析: ${url.hostname}`, 502));
      }
      if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(err.message)) {
        return done(reject, new AppError('tls_error', `TLS 握手失败: ${err.message}`, 502));
      }
      if (code === 'ECONNREFUSED') {
        return done(reject, new AppError('upstream_error', '目标拒绝连接', 502));
      }
      return done(reject, new AppError('upstream_error', `请求失败: ${err.message}`, 502));
    });

    req.end();
  });
}

const elapsed = (start) => Number((process.hrtime.bigint() - start) / 1_000_000n);

/**
 * 完整抓取：DNS 校验 → 逐跳重定向校验 → 大小限制 → 解码。
 * 返回可直接用于分析的统一结构。
 */
export async function fetchPage(rawUrl, cfg, options = {}) {
  const maxRedirects = options.maxRedirects ?? cfg.fetch.maxRedirects;
  const timeoutMs = options.timeoutMs ?? cfg.fetch.timeoutMs;
  const maxBytes = options.maxBytes ?? cfg.fetch.maxBytes;
  const deadline = Date.now() + timeoutMs;

  let current = new URL(rawUrl);
  const chain = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const guard = await assertHostAllowed(current.hostname, cfg.security);
    // 把已校验的 IP 固定给连接层，防止 DNS 重绑定
    const pinned = guard.addresses?.[0];
    const lookup = pinned
      ? (hostname, opts, cb) => {
          if (opts && opts.all) return cb(null, [{ address: pinned, family: pinned.includes(':') ? 6 : 4 }]);
          return cb(null, pinned, pinned.includes(':') ? 6 : 4);
        }
      : undefined;

    const remaining = Math.max(1000, deadline - Date.now());
    let res;
    try {
      res = await requestOnce(current.toString(), {
        timeoutMs: Math.min(remaining, timeoutMs),
        headers: options.headers,
        maxBytes,
        lookup,
        userAgent: cfg.fetch.userAgent,
        method: options.method || 'GET',
      });
    } catch (err) {
      if (err instanceof AppError) {
        err.extra = { ...(err.extra || {}), url: current.toString(), redirects: chain.length };
        throw err;
      }
      throw new AppError('upstream_error', err.message, 502);
    }

    if (options.raw) return res;

    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current);
      chain.push({ from: current.toString(), to: next.toString(), status: res.status });
      if (!/^https?:$/.test(next.protocol)) {
        throw new AppError('upstream_error', `重定向到不支持的协议: ${next.protocol}`, 502);
      }
      current = next;
      continue;
    }

    const contentType = String(res.headers['content-type'] || '');
    const buf = res.body || Buffer.alloc(0);
    const charset = detectCharset(contentType, buf);
    const text = decodeBuffer(buf, charset);

    return {
      finalUrl: current.toString(),
      requestedUrl: rawUrl,
      status: res.status,
      headers: res.headers,
      contentType,
      charset,
      html: text,
      bytes: res.bytes ?? buf.length,
      truncated: Boolean(res.truncated),
      elapsedMs: res.ms,
      redirects: chain,
    };
  }
  throw new AppError('too_many_redirects', `重定向次数超过 ${maxRedirects}`, 502, { redirects: chain });
}

function detectCharset(contentType, buf) {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType);
  if (m) return m[1].toLowerCase();
  // 从前 2KB 里的 <meta charset> 猜
  const head = buf.subarray(0, 2048).toString('latin1');
  const m2 = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  if (m2) return m2[1].toLowerCase();
  return 'utf-8';
}

function decodeBuffer(buf, charset) {
  const label = (charset || 'utf-8').toLowerCase();
  if (label === 'utf-8' || label === 'utf8') return buf.toString('utf8');
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/** 带并发上限的批量抓取 */
export async function fetchMany(urls, cfg, { concurrency = cfg.fetch.concurrencyPerAudit, optional = false } = {}) {
  const results = new Array(urls.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
    while (cursor < urls.length) {
      const idx = cursor++;
      try {
        results[idx] = await fetchPage(urls[idx], cfg);
      } catch (err) {
        results[idx] = { error: err instanceof AppError ? err.toJSON() : { code: 'upstream_error', message: String(err?.message || err) } };
        if (!optional) logger.debug('fetch failed', urls[idx], err.message);
      }
    }
  });
  await Promise.all(workers);
  return results;
}
