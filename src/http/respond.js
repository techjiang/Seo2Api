import zlib from 'node:zlib';

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content',
  301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 422: 'Unprocessable Entity', 429: 'Too Many Requests',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

const COMPRESSIBLE = /^(application\/(json|javascript|xml|ld\+json)|text\/|image\/svg)/i;
const MIN_COMPRESS = 1024;

/** 根据 Accept-Encoding 选择压缩方式，优先 brotli */
function pickEncoding(req) {
  const ae = String(req.headers['accept-encoding'] || '').toLowerCase();
  if (/\bbr\b/.test(ae)) return 'br';
  if (/\bgzip\b/.test(ae)) return 'gzip';
  if (/\bdeflate\b/.test(ae)) return 'deflate';
  return null;
}

export function send(req, res, status, body, headers = {}) {
  if (res.writableEnded) return;
  const payload = body === undefined || body === null ? '' : body;
  const merged = {
    'content-type': 'text/plain; charset=utf-8',
    'x-content-type-options': 'nosniff',
    ...headers,
  };

  // 页面是每次请求现渲染的，不压缩的话首屏 HTML 会带着 30KB+ 的 CSS/JS 一起下载
  const type = String(merged['content-type'] || '');
  const raw = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const enc = COMPRESSIBLE.test(type) ? pickEncoding(req) : null;
  if (enc && raw.length >= MIN_COMPRESS) {
    try {
      const packed = enc === 'br'
        ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
        : enc === 'gzip' ? zlib.gzipSync(raw, { level: 6 }) : zlib.deflateSync(raw);
      merged['content-encoding'] = enc;
      merged.vary = 'accept-encoding';
      merged['content-length'] = String(packed.length);
      res.writeHead(status, merged);
      return res.end(packed);
    } catch {
      // 压缩失败就发原文，不影响正确性
    }
  }
  res.writeHead(status, merged);
  res.end(raw);
}

export function sendJson(req, res, status, data, headers = {}) {
  const json = JSON.stringify(data);
  const buf = Buffer.from(json, 'utf8');
  const type = headers['content-type'] || 'application/json; charset=utf-8';
  const outHeaders = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-robots-tag': 'noindex',
    ...headers,
    'content-type': type,
    vary: 'accept-encoding, authorization',
  };

  let body = buf;
  const enc = pickEncoding(req);
  if (enc && COMPRESSIBLE.test(type) && buf.length >= MIN_COMPRESS) {
    try {
      body = enc === 'br'
        ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
        : enc === 'gzip' ? zlib.gzipSync(buf, { level: 6 }) : zlib.deflateSync(buf);
      outHeaders['content-encoding'] = enc;
    } catch {
      body = buf;
    }
  }
  outHeaders['content-length'] = String(body.length);
  if (res.writableEnded) return;
  res.writeHead(status, STATUS_TEXT[status] ? outHeaders : outHeaders);
  res.end(body);
}

export function sendError(req, res, err, requestId) {
  const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const payload = {
    ok: false,
    error: typeof err?.toJSON === 'function'
      ? err.toJSON()
      : { code: 'internal_error', message: String(err?.message || err) },
    requestId,
    timestamp: new Date().toISOString(),
  };
  const headers = {};
  if (err?.code === 'rate_limited' && err.extra?.retryAfter) {
    headers['retry-after'] = String(err.extra.retryAfter);
  }
  if (status === 405 && err?.extra?.allow) headers.allow = err.extra.allow;
  sendJson(req, res, status, payload, headers);
}

export function sendText(req, res, status, text, headers = {}) {
  const buf = Buffer.from(text, 'utf8');
  const outHeaders = { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers };
  let body = buf;
  const enc = pickEncoding(req);
  if (enc && buf.length >= MIN_COMPRESS) {
    try {
      body = enc === 'br' ? zlib.brotliCompressSync(buf) : enc === 'gzip' ? zlib.gzipSync(buf) : zlib.deflateSync(buf);
      outHeaders['content-encoding'] = enc;
    } catch { body = buf; }
  }
  outHeaders['content-length'] = String(body.length);
  res.writeHead(status, outHeaders);
  res.end(body);
}
