#!/usr/bin/env node
/**
 * Seo2Api 运维命令行。
 *
 *   node scripts/seo2api.js doctor          自检环境与数据
 *   node scripts/seo2api.js backup [dir]    备份数据库
 *   node scripts/seo2api.js restore <file>  从备份恢复
 *   node scripts/seo2api.js list            查看备份列表
 *   node scripts/seo2api.js keygen <name>   创建 API Key
 *   node scripts/seo2api.js stats           查看数据统计
 *   node scripts/seo2api.js export <dir>    导出全部数据为 JSON（便于二次分析）
 *   node scripts/seo2api.js prune [days]    清理旧用量日志
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../src/config.js';
import { Store } from '../src/core/db.js';
import { VERSION } from '../src/server.js';

const [cmd, ...args] = process.argv.slice(2);
const cfg = loadConfig();

// 输出被 head / grep -q 提前关掉时不要抛 EPIPE 堆栈，命令行工具该安静退出
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

const ok = (s) => console.log(`  ✓ ${s}`);
const bad = (s) => console.log(`  ✗ ${s}`);
const info = (s) => console.log(`    ${s}`);

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

async function doctor() {
  console.log(`\nSeo2Api ${VERSION} 环境自检\n`);
  let problems = 0;

  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  console.log('运行时');
  nodeOk ? ok(`Node.js ${process.versions.node}`) : (problems++, bad(`Node.js ${process.versions.node} 过低，需要 ≥ 22.13.0（node:sqlite 从该版本起默认可用）`));

  try {
    const { DatabaseSync } = await import('node:sqlite');
    new DatabaseSync(':memory:').close();
    ok('node:sqlite 可用');
  } catch (err) {
    problems++;
    bad(`node:sqlite 不可用：${err.message}`);
    info('请升级到 Node.js 22.13+ ；更老的 22.x 需要 --experimental-sqlite 才能加载 node:sqlite');
  }

  console.log('\n目录与权限');
  try {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const probe = path.join(cfg.dataDir, `.write-test-${Date.now()}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    ok(`数据目录可写：${cfg.dataDir}`);
  } catch (err) {
    problems++;
    bad(`数据目录不可写：${cfg.dataDir}（${err.message}）`);
  }

  const freeBytes = (() => {
    try { const s = fs.statfsSync(cfg.dataDir); return s.bavail * s.bsize; } catch { return null; }
  })();
  if (freeBytes !== null) {
    if (freeBytes < 100 * 1024 ** 2) {
      problems++;
      bad(`磁盘剩余空间仅 ${human(freeBytes)}，建议至少 100MB`);
    } else {
      ok(`磁盘剩余空间 ${human(freeBytes)}`);
    }
  }

  console.log('\n配置');
  if (cfg.hasConfigFile) ok(`已加载配置文件：${cfg.configPath}`);
  else info(`未找到 config.json，使用默认值（可运行 node server.js --write-config 生成）`);
  ok(`监听 ${cfg.host}:${cfg.port}`);
  ok(`对外地址 ${cfg.publicUrl}`);
  ok(`鉴权模式 ${cfg.auth.mode}`);

  if (cfg.auth.mode === 'key') {
    if (cfg.auth.adminToken) {
      if (cfg.auth.adminToken.length < 16) {
        problems++;
        bad('admin token 过短（< 16 字符），建议用 32 位以上随机串');
      } else ok('admin token 已设置');
    } else {
      info('未设置 admin token：管理接口将不可用，也无法创建 API Key');
    }
  }

  console.log('\n数据库');
  if (!fs.existsSync(path.join(cfg.dataDir, 'seo2api.db'))) {
    info('数据库尚未创建，首次启动时自动初始化');
  } else {
    const store = new Store(cfg);
    try {
      const s = store.stats();
      s.integrity === 'ok' ? ok(`数据库完整（schema v${s.schemaVersion}，${human(s.bytes)}）`) : (problems++, bad(`数据库完整性异常：${s.integrity}`));
      ok(`报告 ${s.audits} 条 · API Key ${s.keys} 个 · 监控 ${s.watches} 项`);
      const backups = store.listBackups();
      if (backups.length) {
        const latest = backups[0];
        const ageDays = (Date.now() - latest.mtime) / 86_400_000;
        if (ageDays > 7) {
          info(`最近一次备份在 ${ageDays.toFixed(1)} 天前，建议设置定时备份`);
        } else ok(`最近备份：${latest.file}`);
      } else {
        info('尚无备份，可运行 node scripts/seo2api.js backup');
      }
    } finally {
      store.close();
    }
  }

  console.log('\n网络');
  try {
    const res = await fetch(`${cfg.publicUrl}/health`, { signal: AbortSignal.timeout(3000) });
    res.ok ? ok(`服务在线：${cfg.publicUrl}`) : bad(`服务返回 ${res.status}`);
  } catch {
    info('服务当前未运行（自检不需要它）');
  }

  console.log('');
  if (problems) {
    console.log(`发现 ${problems} 个问题，请按上面提示处理。\n`);
    process.exit(1);
  }
  console.log('一切正常，可以启动服务。\n');
}

function backup() {
  const store = new Store(cfg);
  try {
    const dir = args[0] ? path.resolve(args[0]) : undefined;
    const r = store.backup(dir);
    console.log(`\n备份完成`);
    console.log(`  文件  ${r.path}`);
    console.log(`  大小  ${human(r.bytes)}`);
    console.log(`  内容  ${r.audits} 条报告 / ${r.keys} 个 Key / ${r.watches} 项监控\n`);
    console.log(`恢复：node scripts/seo2api.js restore ${r.path}\n`);
  } finally { store.close(); }
}

function list() {
  const store = new Store(cfg);
  try {
    const items = store.listBackups();
    if (!items.length) return console.log('\n还没有备份。运行 node scripts/seo2api.js backup 创建。\n');
    console.log(`\n共 ${items.length} 个备份\n`);
    for (const b of items) {
      const when = new Date(b.mtime).toISOString().replace('T', ' ').slice(0, 19);
      console.log(`  ${when}  ${human(b.bytes).padStart(9)}  ${b.file}`);
    }
    console.log('');
  } finally { store.close(); }
}

async function restore() {
  const file = args[0];
  if (!file) {
    console.error('用法: node scripts/seo2api.js restore <备份文件>');
    process.exit(1);
  }
  const src = path.resolve(file);
  if (!fs.existsSync(src)) {
    console.error(`文件不存在: ${src}`);
    process.exit(1);
  }

  // 先用临时目录验证备份是否可用，避免把坏文件覆盖到线上
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo2api-restore-'));
  fs.copyFileSync(src, path.join(tmp, 'seo2api.db'));
  let integrity = 'unreadable';
  let audits = 0;
  try {
    const probe = new Store({ dataDir: tmp });
    integrity = probe.stats().integrity;
    audits = probe.countAudits();
    probe.close();
  } catch (err) {
    integrity = `unreadable: ${err.message}`;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (integrity !== 'ok') {
    console.error(`\n备份文件校验失败（${integrity}）`);
    console.error('已中止恢复，原数据未改动。\n');
    process.exit(1);
  }

  const target = path.join(cfg.dataDir, 'seo2api.db');
  fs.mkdirSync(cfg.dataDir, { recursive: true });

  if (fs.existsSync(target)) {
    const safety = `${target}.before-restore-${Date.now()}`;
    fs.copyFileSync(target, safety);
    console.log(`\n当前数据已另存：${safety}`);
  }
  // 清掉 WAL/SHM，否则旧日志会和新主库混在一起
  for (const suffix of ['-wal', '-shm']) {
    const p = target + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.copyFileSync(src, target);

  const verify = new Store(cfg);
  const s = verify.stats();
  verify.close();
  console.log(`恢复完成：${audits} 条报告，完整性 ${s.integrity}\n`);
  if (s.integrity !== 'ok') {
    console.error('恢复后校验异常，请用上面的 .before-restore 文件回滚。\n');
    process.exit(1);
  }
}

function keygen() {
  const name = args[0] || 'default';
  const store = new Store(cfg);
  try {
    const k = store.createKey({ name, quotaPerMin: Number(args[1]) || cfg.auth.defaultQuotaPerMin });
    console.log(`\n已创建 API Key`);
    console.log(`  ID      ${k.id}`);
    console.log(`  名称    ${k.name}`);
    console.log(`  Key     ${k.key}`);
    console.log(`  配额    ${k.quotaPerMin} 次/分钟\n`);
    console.log(`  明文 key 只显示这一次，请立刻保存。\n`);
    console.log(`  用法： curl -H 'Authorization: Bearer ${k.key}' ${cfg.publicUrl}/v1/reports\n`);
  } finally { store.close(); }
}

function stats() {
  const store = new Store(cfg);
  try {
    const s = store.stats();
    const usage = store.usageStats({ since: Date.now() - 7 * 86_400_000 });
    console.log(`\n数据统计\n`);
    console.log(`  数据库      ${s.file}`);
    console.log(`  大小        ${human(s.bytes)}`);
    console.log(`  schema      v${s.schemaVersion}`);
    console.log(`  完整性      ${s.integrity}`);
    console.log(`  报告        ${s.audits} 条`);
    console.log(`  API Key     ${s.keys} 个（启用中）`);
    console.log(`  监控        ${s.watches} 项`);
    console.log(`\n  近 7 天请求  ${usage.total} 次（错误 ${usage.errors}）`);
    if (usage.byEndpoint.length) {
      console.log('');
      for (const e of usage.byEndpoint) {
        console.log(`    ${String(e.count).padStart(6)}  ${String(e.avgMs).padStart(5)}ms  ${e.endpoint}`);
      }
    }
    console.log('');
  } finally { store.close(); }
}

function exportData() {
  const dir = path.resolve(args[0] || './export');
  fs.mkdirSync(dir, { recursive: true });
  const store = new Store(cfg);
  try {
    const pageSize = 200;
    let offset = 0;
    let total = 0;
    const all = [];
    for (;;) {
      const page = store.listAudits({ limit: pageSize, offset });
      if (!page.items.length) break;
      for (const item of page.items) {
        const full = store.getAudit(item.id);
        all.push(full);
      }
      total = page.total;
      offset += pageSize;
      if (offset >= total) break;
    }
    const out = path.join(dir, 'reports.json');
    fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), total: all.length, items: all }, null, 2));
    const keys = store.listKeys();
    fs.writeFileSync(path.join(dir, 'keys.json'), JSON.stringify({ note: '仅元数据，不含明文 key', items: keys }, null, 2));
    const watches = store.listWatches();
    fs.writeFileSync(path.join(dir, 'watches.json'), JSON.stringify({ items: watches }, null, 2));
    console.log(`\n导出完成：${all.length} 条报告 → ${out}\n`);
  } finally { store.close(); }
}

function prune() {
  const days = Number(args[0] ?? 7);
  const store = new Store(cfg);
  try {
    const n = store.pruneUsage(days);
    console.log(`\n已清理 ${n} 条 ${days} 天前的用量日志\n`);
  } finally { store.close(); }
}

const commands = { doctor, backup, list, restore, keygen, stats, export: exportData, prune };

if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`Seo2Api ${VERSION} 运维工具

  doctor              检查环境、权限、数据库与备份状态
  backup [dir]        备份数据库到 data/backups 或指定目录
  list                列出所有备份
  restore <file>      从备份恢复（会先校验，自动保留旧数据）
  keygen <name> [qpm] 创建 API Key
  stats               查看数据统计与近 7 天请求
  export [dir]        导出报告/Key/监控为 JSON
  prune [days]        清理旧用量日志（默认 7 天）
`);
  process.exit(cmd ? 0 : 1);
}

if (!commands[cmd]) {
  console.error(`未知命令: ${cmd}\n运行 node scripts/seo2api.js help 查看用法`);
  process.exit(1);
}

Promise.resolve()
  .then(() => commands[cmd]())
  .catch((err) => {
    console.error('执行失败:', err?.message || err);
    process.exit(1);
  });
