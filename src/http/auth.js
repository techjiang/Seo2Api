import crypto from 'node:crypto';
import { unauthorized, forbidden } from '../util/errors.js';

/** 常量时间比较，防时序攻击 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function extractToken(req) {
  const auth = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  const h = req.headers['x-api-key'];
  if (h) return String(h).trim();
  const q = new URL(req.url, 'http://x').searchParams;
  const queryToken = q.get('token') || q.get('api_key');
  return queryToken ? queryToken.trim() : null;
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

/**
 * 身份解析：依次判定 admin token / API key / 公开模式。
 * 结果挂在 req.auth 上供后续中间件使用。
 */
export function createAuth(cfg, store) {
  return function authenticate(req) {
    const token = extractToken(req);
    const ip = clientIp(req);

    // admin token 在两种模式下都有效：公开模式也需要有人能管 key 和备份
    if (token && cfg.auth.adminToken && safeEqual(token, cfg.auth.adminToken)) {
      req.auth = { role: 'admin', id: null, name: 'admin', quotaPerMin: 0, ip };
      return req.auth;
    }

    if (cfg.auth.mode === 'none') {
      req.auth = { role: 'public', id: null, name: 'public', quotaPerMin: cfg.rateLimit.max, ip };
      return req.auth;
    }

    if (!token) {
      throw unauthorized('缺少 API Token。请在 Authorization: Bearer <token> 或 X-API-Key 头中提供。');
    }
    const key = store.findKeyByPlain(token);
    if (!key) {
      throw unauthorized('API Token 无效或已被吊销。');
    }
    store.touchKey(key.id);
    req.auth = { role: 'key', id: key.id, name: key.name, quotaPerMin: key.quotaPerMin, ip };
    return req.auth;
  };
}

export function requireAdmin(req) {
  if (req.auth?.role !== 'admin') {
    throw forbidden('该接口需要管理员权限。');
  }
}
