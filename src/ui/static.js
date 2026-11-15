import fs from 'node:fs';
import path from 'node:path';
import { send } from '../http/respond.js';

const PUBLIC_DIR = path.resolve(import.meta.dirname, '../../public');

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** 防目录穿越：解析后必须仍在 public 内 */
export async function serveStatic(req, res, relativePath) {
  const safeRel = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const full = path.resolve(PUBLIC_DIR, safeRel);
  if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== PUBLIC_DIR) {
    return send(req, res, 403, 'Forbidden');
  }
  let stat;
  try {
    stat = await fs.promises.stat(full);
  } catch {
    return send(req, res, 404, 'Not Found');
  }
  if (!stat.isFile()) return send(req, res, 404, 'Not Found');

  const ext = path.extname(full).toLowerCase();
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    return res.end();
  }
  const immutable = path.basename(full).match(/\.[a-f0-9]{8,}\./);
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': String(stat.size),
    etag,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'x-content-type-options': 'nosniff',
    ...(ext === '.svg' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } : {}),
  };
  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    return res.end();
  }
  const stream = fs.createReadStream(full);
  res.writeHead(200, headers);
  stream.pipe(res);
  stream.on('error', () => res.end());
}
