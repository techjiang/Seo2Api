import { badRequest } from './errors.js';

const HOSTNAME_RE = /^(?=.{1,253}$)(?!-)[a-z0-9\u00a1-\uffff-]{1,63}(?<!-)(\.(?!-)[a-z0-9\u00a1-\uffff-]{1,63}(?<!-))*\.?$/i;

/**
 * 把用户输入规范化成 http(s) 绝对 URL。
 * 支持 "example.com"、"example.com/path"、"https://…"，自动补协议。
 */
export function normalizeTarget(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw badRequest('缺少 url 参数，例如 {"url":"https://example.com"}');
  }
  let raw = input.trim();
  if (raw.length > 2048) throw badRequest('URL 长度超过 2048 字符');
  if (/^\/\//.test(raw)) raw = 'https:' + raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw.replace(/^\/+/, '');

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest(`无法解析的 URL: ${input}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('仅支持 http / https 协议');
  }
  if (url.username || url.password) throw badRequest('URL 中不允许携带账号密码');
  const host = url.hostname;
  if (!HOSTNAME_RE.test(host) && !/^\[[0-9a-f:]+\]$/i.test(host)) {
    throw badRequest(`非法主机名: ${host}`);
  }
  if (!host.includes('.') && !/^(localhost|\[.*\])$/i.test(host)) {
    throw badRequest(`主机名不完整: ${host}`);
  }
  url.hash = '';
  // 去掉追踪参数，保证缓存命中率
  for (const p of [...url.searchParams.keys()]) {
    if (/^(utm_|gclid|fbclid|msclkid|_ga$|spm$)/i.test(p)) url.searchParams.delete(p);
  }
  return url;
}

export function originOf(url) {
  const u = typeof url === 'string' ? new URL(url) : url;
  return `${u.protocol}//${u.host}`;
}

export function resolveUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function isSameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** 取注册域（近似 eTLD+1），用于"外链 vs 内链"判断 */
export function registrableDomain(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const twoLevel = new Set([
    'co.uk','org.uk','ac.uk','gov.uk','co.jp','ne.jp','or.jp','com.cn','net.cn','org.cn','gov.cn',
    'com.hk','com.tw','com.sg','com.au','net.au','co.nz','co.kr','co.in','co.za','com.br','com.mx',
    'com.tr','com.ru','co.il','com.ar','com.es','com.pl','co.id','com.my','com.vn','co.th','com.ph',
  ]);
  const last2 = parts.slice(-2).join('.');
  if (twoLevel.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

/** 极简 URL slug，用于快照文件名/徽章缓存键 */
export function slugifyUrl(url) {
  return String(url)
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9._-]+/gi, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
    .toLowerCase();
}
