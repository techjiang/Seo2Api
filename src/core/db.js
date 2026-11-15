import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../util/logger.js';

const SCHEMA_VERSION = 1;

/**
 * 数据层：单个 SQLite 文件 = 全部状态。
 * 备份就是 copy 一个文件，迁移就是把它带走。这是"小白友好"的关键设计。
 */
export class Store {
  constructor(cfg) {
    this.cfg = cfg;
    this.dir = cfg.dataDir;
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(path.join(this.dir, 'backups'), { recursive: true });
    this.file = path.join(this.dir, 'seo2api.db');
    this.db = new DatabaseSync(this.file);
    this.applyPragmas();
    this.migrate();
  }

  applyPragmas() {
    const d = this.db;
    d.exec('PRAGMA journal_mode = WAL');
    d.exec('PRAGMA synchronous = NORMAL');
    d.exec('PRAGMA foreign_keys = ON');
    d.exec('PRAGMA busy_timeout = 5000');
    d.exec('PRAGMA temp_store = MEMORY');
    d.exec('PRAGMA cache_size = -8000');
  }

  migrate() {
    const current = this.db.prepare('PRAGMA user_version').get().user_version ?? 0;
    if (current >= SCHEMA_VERSION) return;
    this.db.exec('BEGIN');
    try {
      if (current < 1) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            quota_per_min INTEGER NOT NULL DEFAULT 60,
            enabled INTEGER NOT NULL DEFAULT 1,
            note TEXT DEFAULT '',
            created_at INTEGER NOT NULL,
            last_used_at INTEGER
          );
          CREATE TABLE IF NOT EXISTS audits (
            id TEXT PRIMARY KEY,
            url TEXT NOT NULL,
            final_url TEXT NOT NULL,
            host TEXT NOT NULL,
            score REAL NOT NULL,
            grade TEXT NOT NULL,
            blocked INTEGER NOT NULL DEFAULT 0,
            critical_count INTEGER NOT NULL DEFAULT 0,
            fail_count INTEGER NOT NULL DEFAULT 0,
            warn_count INTEGER NOT NULL DEFAULT 0,
            pass_count INTEGER NOT NULL DEFAULT 0,
            content_hash TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            mode TEXT NOT NULL DEFAULT 'single',
            report TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_audits_host ON audits(host, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_audits_url ON audits(url, created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_audits_hash ON audits(content_hash);
          CREATE INDEX IF NOT EXISTS idx_audits_created ON audits(created_at DESC);

          CREATE TABLE IF NOT EXISTS watches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            label TEXT DEFAULT '',
            interval_minutes INTEGER NOT NULL DEFAULT 1440,
            webhook_url TEXT DEFAULT '',
            enabled INTEGER NOT NULL DEFAULT 1,
            last_run_at INTEGER,
            last_score REAL,
            last_status TEXT DEFAULT 'pending',
            next_run_at INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_watches_next ON watches(enabled, next_run_at);

          CREATE TABLE IF NOT EXISTS usage_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key_id INTEGER,
            ip TEXT,
            endpoint TEXT NOT NULL,
            status INTEGER NOT NULL,
            duration_ms INTEGER NOT NULL,
            created_at INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_usage_key ON usage_log(key_id, created_at DESC);
        `);
      }
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      this.db.exec('COMMIT');
      logger.info(`数据库已初始化: ${this.file} (schema v${SCHEMA_VERSION})`);
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---------- audits ----------

  saveAudit({ url, finalUrl, host, score, grade, blocked, counts, contentHash, durationMs, mode, report }) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = null;
    this.db.prepare(`
      INSERT INTO audits (id, url, final_url, host, score, grade, blocked, critical_count, fail_count, warn_count, pass_count, content_hash, duration_ms, mode, report, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, url, finalUrl, host, score, grade, blocked ? 1 : 0,
      counts.criticalCount ?? 0, counts.failCount ?? 0, counts.warnCount ?? 0, counts.passCount ?? 0,
      contentHash, durationMs, mode, JSON.stringify(report), createdAt, expiresAt
    );
    return id;
  }

  getAudit(id) {
    const row = this.db.prepare('SELECT * FROM audits WHERE id = ?').get(id);
    if (!row) return null;
    return this.#hydrateAudit(row);
  }

  #hydrateAudit(row) {
    return {
      id: row.id,
      url: row.url,
      finalUrl: row.final_url,
      host: row.host,
      score: row.score,
      grade: row.grade,
      blocked: Boolean(row.blocked),
      counts: {
        criticalCount: row.critical_count,
        failCount: row.fail_count,
        warnCount: row.warn_count,
        passCount: row.pass_count,
      },
      contentHash: row.content_hash,
      durationMs: row.duration_ms,
      mode: row.mode,
      createdAt: row.created_at,
      report: JSON.parse(row.report),
    };
  }

  listAudits({ url, host, limit = 20, offset = 0 } = {}) {
    const where = [];
    const params = [];
    if (url) { where.push('url = ?'); params.push(url); }
    if (host) { where.push('host = ?'); params.push(host); }
    const sql = `SELECT id, url, final_url, host, score, grade, blocked, critical_count, fail_count, warn_count, pass_count, duration_ms, created_at
                 FROM audits ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`;
    const rows = this.db.prepare(sql).all(...params, limit, offset);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM audits ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).get(...params).n;
    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        url: r.url,
        finalUrl: r.final_url,
        host: r.host,
        score: r.score,
        grade: r.grade,
        blocked: Boolean(r.blocked),
        criticalCount: r.critical_count,
        failCount: r.fail_count,
        warnCount: r.warn_count,
        passCount: r.pass_count,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      })),
    };
  }

  /** 同一 URL 的历史，用于趋势对比 */
  history(url, limit = 30) {
    const rows = this.db.prepare(`SELECT id, url, score, grade, fail_count, warn_count, created_at
                                  FROM audits WHERE url = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(url, limit);
    return rows.map((r) => ({
      id: r.id, url: r.url, score: r.score, grade: r.grade,
      failCount: r.fail_count, warnCount: r.warn_count, createdAt: r.created_at,
    }));
  }

  latestByUrl(url) {
    // created_at 精度到毫秒，同毫秒内多次写入时需要 rowid 兜底，否则会取到旧的
    const row = this.db.prepare('SELECT * FROM audits WHERE url = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(url);
    return row ? this.#hydrateAudit(row) : null;
  }

  countAudits() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM audits').get().n;
  }

  // ---------- api keys ----------

  static hashKey(plain) {
    return crypto.createHash('sha256').update(plain).digest('hex');
  }

  createKey({ name, quotaPerMin = 60, note = '' }) {
    const plain = 's2a_' + crypto.randomBytes(24).toString('base64url');
    const keyHash = Store.hashKey(plain);
    const prefix = plain.slice(0, 8);
    const info = this.db.prepare(`INSERT INTO api_keys (name, key_hash, key_prefix, quota_per_min, note, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?)`).run(name, keyHash, prefix, quotaPerMin, note, Date.now());
    return { id: Number(info.lastInsertRowid), name, key: plain, prefix, quotaPerMin, note };
  }

  findKeyByPlain(plain) {
    const hash = Store.hashKey(plain);
    const row = this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND enabled = 1').get(hash);
    if (!row) return null;
    return { id: row.id, name: row.name, prefix: row.key_prefix, quotaPerMin: row.quota_per_min, enabled: Boolean(row.enabled), note: row.note, createdAt: row.created_at, lastUsedAt: row.last_used_at };
  }

  listKeys() {
    return this.db.prepare('SELECT id, name, key_prefix, quota_per_min, enabled, note, created_at, last_used_at FROM api_keys ORDER BY id DESC')
      .all()
      .map((r) => ({ id: r.id, name: r.name, prefix: r.key_prefix, quotaPerMin: r.quota_per_min, enabled: Boolean(r.enabled), note: r.note, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
  }

  revokeKey(id) {
    return this.db.prepare('UPDATE api_keys SET enabled = 0 WHERE id = ?').run(id).changes > 0;
  }

  deleteKey(id) {
    return this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id).changes > 0;
  }

  touchKey(id) {
    this.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(Date.now(), id);
  }

  countKeys() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE enabled = 1').get().n;
  }

  // ---------- watches ----------

  createWatch({ url, label = '', intervalMinutes = 1440, webhookUrl = '' }) {
    const info = this.db.prepare(`INSERT INTO watches (url, label, interval_minutes, webhook_url, next_run_at, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?)`)
      .run(url, label, intervalMinutes, webhookUrl, Date.now(), Date.now());
    return this.getWatch(Number(info.lastInsertRowid));
  }

  getWatch(id) {
    const r = this.db.prepare('SELECT * FROM watches WHERE id = ?').get(id);
    return r ? mapWatch(r) : null;
  }

  listWatches() {
    return this.db.prepare('SELECT * FROM watches ORDER BY id DESC').all().map(mapWatch);
  }

  dueWatches(now = Date.now()) {
    return this.db.prepare('SELECT * FROM watches WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at LIMIT 10').all(now).map(mapWatch);
  }

  updateWatchRun(id, { score, status, intervalMinutes }) {
    const nextRun = Date.now() + Math.max(1, intervalMinutes) * 60_000;
    this.db.prepare('UPDATE watches SET last_run_at = ?, last_score = ?, last_status = ?, next_run_at = ? WHERE id = ?')
      .run(Date.now(), score, status, nextRun, id);
  }

  deleteWatch(id) {
    return this.db.prepare('DELETE FROM watches WHERE id = ?').run(id).changes > 0;
  }

  toggleWatch(id, enabled) {
    this.db.prepare('UPDATE watches SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
    return this.getWatch(id);
  }

  // ---------- usage ----------

  logUsage({ keyId = null, ip = '', endpoint, status, durationMs }) {
    // 用量日志只保留 7 天，避免无限增长
    this.db.prepare('INSERT INTO usage_log (key_id, ip, endpoint, status, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(keyId, ip, endpoint, status, durationMs, Date.now());
  }

  usageStats({ since = Date.now() - 86_400_000 } = {}) {
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM usage_log WHERE created_at >= ?').get(since).n;
    const byEndpoint = this.db.prepare('SELECT endpoint, COUNT(*) AS n, AVG(duration_ms) AS avg_ms FROM usage_log WHERE created_at >= ? GROUP BY endpoint ORDER BY n DESC LIMIT 12')
      .all(since).map((r) => ({ endpoint: r.endpoint, count: r.n, avgMs: Math.round(r.avg_ms || 0) }));
    const errors = this.db.prepare('SELECT COUNT(*) AS n FROM usage_log WHERE created_at >= ? AND status >= 400').get(since).n;
    return { total, errors, byEndpoint };
  }

  pruneUsage(days = 7) {
    const cutoff = Date.now() - days * 86_400_000;
    // 用 <= 而非 <：days=0 表示"清空"，边界值才不会因同毫秒写入而漏删
    const info = this.db.prepare('DELETE FROM usage_log WHERE created_at <= ?').run(cutoff);
    return info.changes;
  }

  // ---------- maintenance ----------

  /** 一致性快照备份：VACUUM INTO 生成单文件副本，比直接 cp 更安全 */
  backup(targetDir = path.join(this.dir, 'backups')) {
    fs.mkdirSync(targetDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(targetDir, `seo2api-${stamp}.db`);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const meta = {
      file: path.basename(file),
      bytes: fs.statSync(file).size,
      createdAt: Date.now(),
      schemaVersion: this.db.prepare('PRAGMA user_version').get().user_version,
      audits: this.countAudits(),
      keys: this.countKeys(),
      watches: this.listWatches().length,
    };
    fs.writeFileSync(file + '.json', JSON.stringify(meta, null, 2));
    return { path: file, ...meta };
  }

  listBackups() {
    const dir = path.join(this.dir, 'backups');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        let meta = null;
        try { meta = JSON.parse(fs.readFileSync(full + '.json', 'utf8')); } catch { /* 忽略 */ }
        return { file: f, path: full, bytes: stat.size, mtime: stat.mtimeMs, meta };
      })
      .sort((a, b) => b.mtime - a.mtime);
  }

  integrityCheck() {
    const row = this.db.prepare('PRAGMA integrity_check').get();
    return row?.integrity_check ?? 'unknown';
  }

  stats() {
    const dbStat = fs.existsSync(this.file) ? fs.statSync(this.file) : { size: 0 };
    return {
      file: this.file,
      bytes: dbStat.size,
      schemaVersion: this.db.prepare('PRAGMA user_version').get().user_version,
      audits: this.countAudits(),
      keys: this.countKeys(),
      watches: this.listWatches().length,
      integrity: this.integrityCheck(),
    };
  }

  close() {
    try { this.db.close(); } catch { /* 已关闭 */ }
  }
}

function mapWatch(r) {
  return {
    id: r.id,
    url: r.url,
    label: r.label,
    intervalMinutes: r.interval_minutes,
    webhookUrl: r.webhook_url,
    enabled: Boolean(r.enabled),
    lastRunAt: r.last_run_at,
    lastScore: r.last_score,
    lastStatus: r.last_status,
    nextRunAt: r.next_run_at,
    createdAt: r.created_at,
  };
}
