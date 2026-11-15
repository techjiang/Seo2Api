import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/core/db.js';
import { TtlCache, SingleFlight } from '../src/core/cache.js';
import { RateLimiter } from '../src/http/ratelimit.js';
import { Router } from '../src/http/router.js';
import { renderBadge } from '../src/api/badge.js';
import { compareReports } from '../src/core/analyzer.js';
import { tempDataDir } from './helpers.js';

const cfgFor = (dataDir) => ({ dataDir });

test('数据层', async (t) => {
  const dir = tempDataDir();
  const store = new Store(cfgFor(dir));
  t.after(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t.test('初始化 schema', () => {
    const s = store.stats();
    assert.equal(s.integrity, 'ok');
    assert.ok(s.schemaVersion >= 1);
  });

  await t.test('重复打开不会重建', () => {
    const again = new Store(cfgFor(dir));
    assert.equal(again.stats().integrity, 'ok');
    again.close();
  });

  await t.test('API Key 只存哈希', () => {
    const k = store.createKey({ name: 't1', quotaPerMin: 10 });
    assert.match(k.key, /^s2a_/);
    const raw = fs.readFileSync(path.join(dir, 'seo2api.db'));
    assert.ok(!raw.includes(Buffer.from(k.key)), '明文 key 不应落库');
    assert.ok(store.findKeyByPlain(k.key));
    assert.equal(store.findKeyByPlain(k.key + 'x'), null);
  });

  await t.test('吊销后 key 失效', () => {
    const k = store.createKey({ name: 't2' });
    assert.ok(store.findKeyByPlain(k.key));
    store.revokeKey(k.id);
    assert.equal(store.findKeyByPlain(k.key), null);
  });

  await t.test('审计记录读写', () => {
    const id = store.saveAudit({
      url: 'https://a.com', finalUrl: 'https://a.com/', host: 'a.com',
      score: 77.5, grade: 'B', blocked: false,
      counts: { criticalCount: 0, failCount: 1, warnCount: 2, passCount: 30 },
      contentHash: 'h1', durationMs: 100, mode: 'single',
      report: { score: 77.5, checks: [] },
    });
    const got = store.getAudit(id);
    assert.equal(got.score, 77.5);
    assert.equal(got.report.score, 77.5);
    assert.equal(store.getAudit('nope'), null);
  });

  await t.test('历史按时间倒序', () => {
    store.saveAudit({ url: 'https://b.com', finalUrl: 'https://b.com/', host: 'b.com', score: 60, grade: 'D', blocked: false, counts: {}, contentHash: 'x', durationMs: 1, mode: 'single', report: {} });
    store.saveAudit({ url: 'https://b.com', finalUrl: 'https://b.com/', host: 'b.com', score: 70, grade: 'C', blocked: false, counts: {}, contentHash: 'y', durationMs: 1, mode: 'single', report: {} });
    const h = store.history('https://b.com');
    assert.equal(h.length, 2);
    assert.ok(h[0].createdAt >= h[1].createdAt);
    assert.equal(store.latestByUrl('https://b.com').score, 70);
  });

  await t.test('列表分页与总数', () => {
    const r = store.listAudits({ limit: 2, offset: 0 });
    assert.equal(r.items.length, 2);
    assert.ok(r.total >= 3);
    const r2 = store.listAudits({ host: 'b.com' });
    assert.equal(r2.total, 2);
  });

  await t.test('监控生命周期', () => {
    const w = store.createWatch({ url: 'https://c.com', label: 'c', intervalMinutes: 10 });
    assert.equal(w.enabled, true);
    assert.ok(store.dueWatches(Date.now() + 1000).some((x) => x.id === w.id));
    store.updateWatchRun(w.id, { score: 88, status: 'ok', intervalMinutes: 10 });
    const after = store.getWatch(w.id);
    assert.equal(after.lastScore, 88);
    assert.ok(after.nextRunAt > Date.now() + 9 * 60_000);
    store.toggleWatch(w.id, false);
    assert.equal(store.getWatch(w.id).enabled, false);
    assert.equal(store.deleteWatch(w.id), true);
    assert.equal(store.getWatch(w.id), null);
  });

  await t.test('备份可恢复', () => {
    const backup = store.backup();
    assert.ok(fs.existsSync(backup.path));
    assert.ok(backup.bytes > 0);
    assert.equal(backup.schemaVersion, store.stats().schemaVersion);

    // 用备份文件开一个新库，数据应一致
    const restoreDir = tempDataDir();
    const main = path.join(restoreDir, 'seo2api.db');
    fs.copyFileSync(backup.path, main);
    const restored = new Store(cfgFor(restoreDir));
    assert.equal(restored.countAudits(), store.countAudits());
    assert.equal(restored.stats().integrity, 'ok');
    restored.close();
    fs.rmSync(restoreDir, { recursive: true, force: true });
  });

  await t.test('用量统计与清理', () => {
    store.logUsage({ keyId: 1, ip: '1.2.3.4', endpoint: 'POST /v1/analyze', status: 200, durationMs: 50 });
    const u = store.usageStats();
    assert.ok(u.total >= 1);
    assert.ok(u.byEndpoint.length >= 1);
    const pruned = store.pruneUsage(0);
    assert.ok(pruned >= 1);
  });
});

test('缓存与限流', async (t) => {
  await t.test('TTL 过期', async () => {
    const c = new TtlCache({ ttlMs: 30, maxEntries: 10 });
    c.set('a', 1);
    assert.equal(c.get('a'), 1);
    await new Promise((r) => setTimeout(r, 45));
    assert.equal(c.get('a'), undefined);
  });

  await t.test('LRU 淘汰', () => {
    const c = new TtlCache({ ttlMs: 10_000, maxEntries: 2 });
    c.set('a', 1); c.set('b', 2);
    c.get('a'); // 提升 a
    c.set('c', 3);
    assert.equal(c.get('b'), undefined, 'b 应被淘汰');
    assert.equal(c.get('a'), 1);
  });

  await t.test('并发合并只执行一次', async () => {
    const sf = new SingleFlight();
    let calls = 0;
    const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return 'v'; };
    const [a, b, c] = await Promise.all([sf.run('k', fn), sf.run('k', fn), sf.run('k', fn)]);
    assert.equal(calls, 1);
    assert.deepEqual([a, b, c], ['v', 'v', 'v']);
  });

  await t.test('失败后允许重试', async () => {
    const sf = new SingleFlight();
    let calls = 0;
    await assert.rejects(sf.run('k', async () => { calls++; throw new Error('x'); }));
    const v = await sf.run('k', async () => { calls++; return 'ok'; });
    assert.equal(v, 'ok');
    assert.equal(calls, 2);
  });

  await t.test('限流放行再拒绝', async () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 2, burst: 0 });
    assert.equal(rl.take('k').allowed, true);
    assert.equal(rl.take('k').allowed, true);
    const denied = rl.take('k');
    assert.equal(denied.allowed, false);
    assert.ok(denied.resetMs > 0);
  });

  await t.test('不同 key 独立计数', () => {
    const rl = new RateLimiter({ windowMs: 1000, max: 1, burst: 0 });
    assert.equal(rl.take('a').allowed, true);
    assert.equal(rl.take('a').allowed, false);
    assert.equal(rl.take('b').allowed, true);
  });

  await t.test('随时间补充令牌', async () => {
    const rl = new RateLimiter({ windowMs: 100, max: 10, burst: 0 });
    for (let i = 0; i < 10; i++) rl.take('k');
    assert.equal(rl.take('k').allowed, false);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(rl.take('k').allowed, true);
  });
});

test('路由匹配', async (t) => {
  const r = new Router();
  r.get('/a', () => {});
  r.post('/a', () => {});
  r.get('/b/:id', () => {});
  r.get('/c/*', () => {});

  await t.test('静态路径', () => {
    const m = r.match('GET', '/a');
    assert.ok(m.route);
    assert.equal(m.route.method, 'GET');
  });

  await t.test('方法不匹配列出允许方法', () => {
    const m = r.match('DELETE', '/a');
    assert.equal(m.route, null);
    assert.deepEqual(m.allow.sort(), ['GET', 'POST']);
  });

  await t.test('路径参数与解码', () => {
    const m = r.match('GET', '/b/hello%20world');
    assert.equal(m.params.id, 'hello world');
  });

  await t.test('通配符', () => {
    const m = r.match('GET', '/c/x/y/z.css');
    assert.equal(m.params.wildcard, 'x/y/z.css');
  });

  await t.test('尾斜杠可选', () => {
    assert.ok(r.match('GET', '/a/').route);
  });

  await t.test('不匹配时不误伤', () => {
    assert.equal(r.match('GET', '/ab').route, null);
    assert.equal(r.match('GET', '/a/b').route, null);
  });
});

test('徽章渲染', async (t) => {
  await t.test('SVG 结构合法', () => {
    const svg = renderBadge({ label: 'SEO', message: '92 A+', color: '#22c55e' });
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.endsWith('</svg>'));
    assert.ok(svg.includes('aria-label'));
    assert.ok(svg.includes('<title>'));
  });

  await t.test('特殊字符被转义', () => {
    const svg = renderBadge({ label: '<script>', message: 'a"b&c', color: '#000' });
    assert.ok(!svg.includes('<script>'));
    assert.ok(svg.includes('&lt;script&gt;'));
    assert.ok(svg.includes('&amp;'));
  });

  await t.test('宽度随文本增长', () => {
    const a = renderBadge({ label: 'A', message: '1', color: '#000' });
    const b = renderBadge({ label: 'A much longer label', message: '100 A+', color: '#000' });
    const w = (s) => Number(/width="(\d+)"/.exec(s)[1]);
    assert.ok(w(b) > w(a));
  });

  await t.test('各异等级颜色不同', () => {
    const colors = ['#16a34a', '#ef4444'].map((c) => renderBadge({ label: 'x', message: 'y', color: c }));
    assert.notEqual(colors[0], colors[1]);
  });
});

test('报告对比', async (t) => {
  const mk = (score, checks, dims) => ({
    id: 'x', url: 'https://a.com', score, grade: 'B', analyzedAt: new Date().toISOString(),
    checks, dimensions: dims,
  });
  const before = mk(60, [
    { id: 'a', title: 'A', status: 'fail', dimension: 'content' },
    { id: 'b', title: 'B', status: 'pass', dimension: 'content' },
    { id: 'c', title: 'C', status: 'warn', dimension: 'technical' },
  ], [{ key: 'content', name: '内容', score: 50 }, { key: 'technical', name: '技术', score: 70 }]);
  const after = mk(75, [
    { id: 'a', title: 'A', status: 'pass', dimension: 'content' },
    { id: 'b', title: 'B', status: 'fail', dimension: 'content' },
    { id: 'c', title: 'C', status: 'pass', dimension: 'technical' },
  ], [{ key: 'content', name: '内容', score: 75 }, { key: 'technical', name: '技术', score: 90 }]);

  await t.test('识别修复与退步', () => {
    const r = compareReports(before, after);
    assert.equal(r.delta, 15);
    assert.equal(r.direction, 'up');
    assert.ok(r.fixed.some((f) => f.id === 'a'));
    assert.ok(r.broken.some((b) => b.id === 'b'));
  });

  await t.test('维度差值正确', () => {
    const r = compareReports(before, after);
    assert.equal(r.dimensions.content.delta, 25);
    assert.equal(r.dimensions.technical.delta, 20);
  });

  await t.test('结论文案非空', () => {
    const r = compareReports(before, after);
    assert.ok(r.verdict.length > 5);
  });

  await t.test('持平场景', () => {
    const r = compareReports(before, mk(60, before.checks, before.dimensions));
    assert.equal(r.delta, 0);
    assert.equal(r.direction, 'flat');
  });

  await t.test('缺少报告时报错', () => {
    assert.throws(() => compareReports(null, after));
    assert.throws(() => compareReports(before, null));
  });
});
