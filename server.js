#!/usr/bin/env node
/**
 * Seo2Api 入口。
 *
 * 启动：node server.js
 * 环境变量：见 README / docs/configuration.md
 */
import { createServer, VERSION } from './src/server.js';
import { logger } from './src/util/logger.js';
import { writeExampleConfig } from './src/config.js';
import fs from 'node:fs';
import path from 'node:path';

const args = new Set(process.argv.slice(2));

async function main() {
  if (args.has('--version') || args.has('-v')) {
    console.log(`Seo2Api ${VERSION}`);
    return;
  }
  if (args.has('--write-config')) {
    const p = writeExampleConfig();
    console.log(`已写入默认配置: ${p}`);
    return;
  }
  if (args.has('--help') || args.has('-h')) {
    console.log(`Seo2Api ${VERSION} — 网站 SEO 检测与评分 API

用法:
  node server.js                启动服务
  node server.js --write-config 生成 config.example.json
  node server.js --version      显示版本

环境变量:
  SEO2API_PORT          监听端口（默认 8787）
  SEO2API_HOST          监听地址（默认 0.0.0.0）
  SEO2API_DATA_DIR      数据目录（默认 ./data）
  SEO2API_AUTH_MODE     key | none（默认 key）
  SEO2API_ADMIN_TOKEN   管理员 Token
  SEO2API_PUBLIC_URL    对外访问地址，用于生成报告链接

更多: docs/configuration.md`);
    return;
  }

  const app = await createServer();
  const addr = await app.listen(app.cfg.port, app.cfg.host);
  const base = app.cfg.publicUrl || `http://localhost:${addr.port}`;

  logger.info(`Seo2Api ${VERSION} 已启动`);
  logger.info(`  访问地址   ${base}`);
  logger.info(`  数据目录   ${app.cfg.dataDir}`);
  logger.info(`  鉴权模式   ${app.cfg.auth.mode}${app.cfg.auth.mode === 'key' && !app.cfg.auth.adminToken ? '（未设置 admin token，管理接口不可用）' : ''}`);
  if (app.cfg.auth.mode === 'key' && !app.store.listKeys().length && !app.cfg.auth.adminToken) {
    logger.warn('  尚未创建任何 API Key。设置 SEO2API_ADMIN_TOKEN 后调用 POST /v1/admin/keys 创建，或设 SEO2API_AUTH_MODE=none 先跑起来。');
  }

  app.watchApi.start();
  if (args.has('--no-watch')) app.watchApi.stop();

  // 每日清理用量日志 + 自动备份
  const daily = setInterval(() => {
    try {
      const pruned = app.store.pruneUsage(7);
      const backup = app.store.backup();
      logger.info(`例行维护：清理 ${pruned} 条用量日志，备份 ${backup.file}`);
    } catch (err) {
      logger.warn('例行维护失败', err.message);
    }
  }, 24 * 60 * 60 * 1000);
  if (daily.unref) daily.unref();

  const shutdown = async (signal) => {
    logger.info(`收到 ${signal}，正在关闭…`);
    clearInterval(daily);
    try {
      await app.close();
      logger.info('已安全退出');
      process.exit(0);
    } catch (err) {
      logger.error('退出时出错', err.message);
      process.exit(1);
    }
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    logger.error('未处理的 Promise 拒绝', err?.stack || err);
  });
  process.on('uncaughtException', (err) => {
    logger.error('未捕获异常', err?.stack || err);
  });
}

main().catch((err) => {
  console.error('启动失败:', err?.stack || err);
  process.exit(1);
});
