import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');

/** 全量默认配置。所有项都可通过 config.json 或 SEO2API_* 环境变量覆盖。 */
export const DEFAULTS = {
  host: '0.0.0.0',
  port: 8787,
  dataDir: './data',
  publicUrl: '',
  logLevel: 'info',
  // 鉴权：none 完全开放；key 需要 API Token（管理接口始终需要 admin token）
  auth: {
    mode: 'key',
    adminToken: '',
    /** 每个 key 的每分钟配额，0 表示只受全局限流约束 */
    defaultQuotaPerMin: 60,
  },
  rateLimit: {
    windowMs: 60_000,
    max: 60,
    /** 每个 IP 额外允许的突发量 */
    burst: 10,
  },
  fetch: {
    timeoutMs: 12_000,
    connectTimeoutMs: 6_000,
    maxBytes: 4 * 1024 * 1024,
    maxRedirects: 5,
    concurrencyPerAudit: 4,
    userAgent:
      'Mozilla/5.0 (compatible; Seo2Api/1.0; +https://github.com/seo2api) AppleWebKit/537.36 Chrome/124 Safari/537.36',
    /** 是否抓取 robots.txt / sitemap.xml / llms.txt 等辅助资源 */
    fetchAuxiliary: true,
  },
  security: {
    /** 禁止抓取内网/回环/链路本地地址，防 SSRF */
    blockPrivateNetworks: true,
    /** 允许抓取的主机白名单（为空表示不限制） */
    allowHosts: [],
    /** 禁止抓取的主机黑名单 */
    denyHosts: [],
  },
  cache: {
    ttlMs: 5 * 60_000,
    maxEntries: 512,
    /** 相同内容哈希的站点直接复用评分结果 */
    contentHashReuse: true,
  },
  limits: {
    batchMax: 20,
    historyMax: 200,
  },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    out[k] = isPlainObject(v) && isPlainObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

const toInt = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const toBool = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v));
};

/** 环境变量 → 配置键的映射，只暴露最常用的项，避免配置面过大。 */
const ENV_MAP = [
  ['SEO2API_HOST', (c, v) => void (c.host = v)],
  ['PORT', (c, v) => void (c.port = toInt(v, c.port))],
  ['SEO2API_PORT', (c, v) => void (c.port = toInt(v, c.port))],
  ['SEO2API_DATA_DIR', (c, v) => void (c.dataDir = v)],
  ['SEO2API_PUBLIC_URL', (c, v) => void (c.publicUrl = v.replace(/\/+$/, ''))],
  ['SEO2API_LOG_LEVEL', (c, v) => void (c.logLevel = v)],
  ['SEO2API_AUTH_MODE', (c, v) => void (c.auth.mode = v)],
  ['SEO2API_ADMIN_TOKEN', (c, v) => void (c.auth.adminToken = v)],
  ['SEO2API_RATE_MAX', (c, v) => void (c.rateLimit.max = toInt(v, c.rateLimit.max))],
  ['SEO2API_FETCH_TIMEOUT_MS', (c, v) => void (c.fetch.timeoutMs = toInt(v, c.fetch.timeoutMs))],
  ['SEO2API_ALLOW_PRIVATE', (c, v) => void (c.security.blockPrivateNetworks = !toBool(v, false))],
  ['SEO2API_CACHE_TTL_MS', (c, v) => void (c.cache.ttlMs = toInt(v, c.cache.ttlMs))],
];

export function loadConfig(overrides = {}) {
  let cfg = structuredClone(DEFAULTS);
  const file = process.env.SEO2API_CONFIG || path.join(ROOT, 'config.json');
  let fromFile = {};
  if (fs.existsSync(file)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(file, 'utf8'));
      cfg = deepMerge(cfg, fromFile);
    } catch (err) {
      throw new Error(`配置文件解析失败 ${file}: ${err.message}`);
    }
  }
  for (const [env, apply] of ENV_MAP) {
    if (process.env[env] !== undefined) apply(cfg, process.env[env]);
  }
  cfg = deepMerge(cfg, overrides);
  cfg.root = ROOT;
  cfg.dataDir = path.isAbsolute(cfg.dataDir) ? cfg.dataDir : path.join(ROOT, cfg.dataDir);
  cfg.publicUrl = (cfg.publicUrl || `http://localhost:${cfg.port}`).replace(/\/+$/, '');
  cfg.auth.adminToken = cfg.auth.adminToken || process.env.SEO2API_ADMIN_TOKEN || '';
  cfg.hasConfigFile = Object.keys(fromFile).length > 0;
  cfg.configPath = file;
  cfg.instanceId = crypto.createHash('sha1').update(`${cfg.dataDir}:${ROOT}`).digest('hex').slice(0, 12);
  return cfg;
}

/** 首次启动时把默认配置落到磁盘，方便"小白"直接改文件。 */
export function writeExampleConfig(target = path.join(ROOT, 'config.example.json')) {
  fs.writeFileSync(target, JSON.stringify(DEFAULTS, null, 2) + '\n');
  return target;
}
