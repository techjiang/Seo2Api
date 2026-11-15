import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { startTestServer, jsonRequest } from './helpers.js';
import { bestPageHtml } from './helpers.js';

/** 起一个本地假站点，用于端到端验证抓取链路（测试服务器关闭了内网拦截） */
async function startFixtureSite() {
  const site = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
    }
    if (url.pathname === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1/</loc></url></urlset>');
    }
    if (url.pathname === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('# Fixture\n> A test site\n\n## Pages\n- [Home](http://127.0.0.1/)\n');
    }
    if (url.pathname === '/redirect') {
      res.writeHead(301, { location: '/' });
      return res.end();
    }
    if (url.pathname === '/slow') {
      setTimeout(() => { res.writeHead(200); res.end('<html><head><title>slow</title></head><body></body></html>'); }, 30_000);
      return;
    }
    if (url.pathname === '/big') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>' + 'x'.repeat(20 * 1024 * 1024) + '</body></html>');
      return;
    }
    if (url.pathname === '/404') {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('<html><head><title>Not Found</title></head><body><h1>404</h1></body></html>');
    }
    if (url.pathname === '/gzip') {
      const body = zlib.gzipSync(Buffer.from(bestPageHtml(`http://127.0.0.1:${port}`)));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' });
      return res.end(body);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(bestPageHtml(`http://127.0.0.1:${port}`));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const port = site.address().port;
  return { site, port, base: `http://127.0.0.1:${port}` };
}

test('HTTP API 集成', async (t) => {
  const fixture = await startFixtureSite();
  // 测试环境放开内网限制，才能访问 fixture
  const srv = await startTestServer({
    security: { blockPrivateNetworks: false, allowHosts: [], denyHosts: [] },
  });
  t.after(async () => {
    await srv.stop();
    await new Promise((r) => fixture.site.close(r));
  });

  await t.test('健康检查', async () => {
    const r = await jsonRequest(srv.url('/health'));
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.database.integrity, 'ok');
  });

  await t.test('首页与文档页可访问', async () => {
    for (const p of ['/', '/docs']) {
      const res = await fetch(srv.url(p));
      assert.equal(res.status, 200, p);
      const html = await res.text();
      assert.ok(html.includes('</html>'), `${p} 应返回完整 HTML`);
    }
  });

  await t.test('分析接口返回完整报告', async () => {
    const r = await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
    assert.equal(r.status, 200);
    const d = r.json.data;
    assert.ok(typeof d.id === 'string' && d.id.length > 10);
    assert.ok(d.score >= 0 && d.score <= 100);
    assert.equal(d.checks.length, 84);
    assert.equal(d.dimensions.length, 8);
    assert.ok(d.reportUrl.endsWith(`/report/${d.id}`));
    assert.ok(d.page.title.includes('SEO'));
  });

  await t.test('分析结果可被再次读取', async () => {
    const a = await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
    const id = a.json.data.id;
    const r = await jsonRequest(srv.url(`/v1/report/${id}`));
    assert.equal(r.status, 200);
    assert.equal(r.json.data.id, id);
    assert.equal(r.json.data.report.score, a.json.data.score);
  });

  await t.test('报告页 HTML 可渲染', async () => {
    const a = await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
    const res = await fetch(srv.url(`/report/${a.json.data.id}`));
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('维度得分'));
    assert.ok(html.includes('<svg'));
  });

  await t.test('不存在的报告返回 404', async () => {
    const r = await jsonRequest(srv.url('/v1/report/00000000-0000-0000-0000-000000000000'));
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'not_found');
  });

  await t.test('缺少 url 参数返回 400', async () => {
    const r = await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: {} });
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, 'bad_request');
  });

  await t.test('非法 JSON 返回 400', async () => {
    const res = await fetch(srv.url('/v1/analyze'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(res.status, 400);
  });

  await t.test('错误的 Content-Type 返回 415', async () => {
    const res = await fetch(srv.url('/v1/analyze'), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'hello',
    });
    assert.equal(res.status, 415);
  });

  await t.test('批量分析', async () => {
    const r = await jsonRequest(srv.url('/v1/batch'), {
      method: 'POST',
      body: { urls: [fixture.base, `${fixture.base}/404`], fast: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.total, 2);
    assert.equal(r.json.data.succeeded, 2);
    assert.ok(r.json.data.averageScore > 0);
  });

  await t.test('批量去重', async () => {
    const r = await jsonRequest(srv.url('/v1/batch'), {
      method: 'POST',
      body: { urls: [fixture.base, fixture.base, fixture.base], fast: true },
    });
    assert.equal(r.json.data.total, 1);
  });

  await t.test('批量空数组返回 400', async () => {
    const r = await jsonRequest(srv.url('/v1/batch'), { method: 'POST', body: { urls: [] } });
    assert.equal(r.status, 400);
  });

  await t.test('批量非数组返回 400', async () => {
    const r = await jsonRequest(srv.url('/v1/batch'), { method: 'POST', body: { urls: 'x' } });
    assert.equal(r.status, 400);
  });

  await t.test('历史与趋势', async () => {
    await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
    await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
    const r = await jsonRequest(srv.url(`/v1/history?url=${encodeURIComponent(fixture.base)}`));
    assert.equal(r.status, 200);
    assert.ok(r.json.data.total >= 2);
    assert.ok(['up', 'down', 'flat'].includes(r.json.data.direction));
  });

  await t.test('对比两份报告', async () => {
    const r = await jsonRequest(srv.url(`/v1/compare?url=${encodeURIComponent(fixture.base)}`));
    assert.equal(r.status, 200);
    assert.equal(typeof r.json.data.delta, 'number');
    assert.ok(Array.isArray(r.json.data.fixed));
  });

  await t.test('对比缺少参数返回 400', async () => {
    const r = await jsonRequest(srv.url('/v1/compare'));
    assert.equal(r.status, 400);
  });

  await t.test('报告列表分页', async () => {
    const r = await jsonRequest(srv.url('/v1/reports?limit=2'));
    assert.equal(r.status, 200);
    assert.ok(r.json.data.items.length <= 2);
    assert.ok(r.json.data.total >= 2);
  });

  await t.test('徽章返回 SVG', async () => {
    const res = await fetch(srv.url(`/badge?url=${encodeURIComponent(fixture.base)}`));
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
    const svg = await res.text();
    assert.ok(svg.startsWith('<svg'));
    assert.ok(svg.includes('SEO'));
  });

  await t.test('徽章缺 url 返回 400', async () => {
    const res = await fetch(srv.url('/badge'));
    assert.equal(res.status, 400);
  });

  await t.test('监控增删查', async () => {
    const c = await jsonRequest(srv.url('/v1/watches'), {
      method: 'POST',
      body: { url: fixture.base, label: 'fixture', intervalMinutes: 30 },
    });
    assert.equal(c.status, 201);
    const id = c.json.data.id;
    assert.equal(c.json.data.url, fixture.base + '/');

    const list = await jsonRequest(srv.url('/v1/watches'));
    assert.ok(list.json.data.items.some((w) => w.id === id));

    const run = await jsonRequest(srv.url(`/v1/watches/${id}/run`), { method: 'POST' });
    assert.equal(run.status, 200);
    assert.equal(run.json.data.ok, true);

    const del = await jsonRequest(srv.url(`/v1/watches/${id}`), { method: 'DELETE' });
    assert.equal(del.json.data.deleted, true);
  });

  await t.test('重复监控同一 URL 返回 400', async () => {
    await jsonRequest(srv.url('/v1/watches'), { method: 'POST', body: { url: fixture.base } });
    const dup = await jsonRequest(srv.url('/v1/watches'), { method: 'POST', body: { url: fixture.base } });
    assert.equal(dup.status, 400);
  });

  await t.test('管理员接口需要 token', async () => {
    const r = await jsonRequest(srv.url('/v1/admin/keys'));
    assert.equal(r.status, 403);
  });

  await t.test('管理员可创建与吊销 key', async () => {
    const auth = { authorization: 'Bearer test-admin-token' };
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: auth, body: { name: 'ci' } });
    assert.equal(c.status, 201);
    assert.match(c.json.data.key, /^s2a_/);

    const list = await jsonRequest(srv.url('/v1/admin/keys'), { headers: auth });
    assert.ok(list.json.data.items.length >= 1);

    const id = c.json.data.id;
    const rv = await jsonRequest(srv.url(`/v1/admin/keys/${id}/revoke`), { method: 'POST', headers: auth });
    assert.equal(rv.json.data.revoked, true);
  });

  await t.test('管理员可备份', async () => {
    const auth = { authorization: 'Bearer test-admin-token' };
    const r = await jsonRequest(srv.url('/v1/admin/backup'), { method: 'POST', headers: auth });
    assert.equal(r.status, 201);
    assert.ok(r.json.data.bytes > 0);
    const list = await jsonRequest(srv.url('/v1/admin/backups'), { headers: auth });
    assert.ok(list.json.data.items.length >= 1);
  });

  await t.test('未知接口返回 404 JSON', async () => {
    const r = await jsonRequest(srv.url('/v1/nope'));
    assert.equal(r.status, 404);
    assert.equal(r.json.ok, false);
  });

  await t.test('方法不允许返回 405', async () => {
    const res = await fetch(srv.url('/health'), { method: 'DELETE' });
    assert.equal(res.status, 405);
  });

  await t.test('CORS 预检', async () => {
    const res = await fetch(srv.url('/v1/analyze'), { method: 'OPTIONS' });
    assert.equal(res.status, 204);
    assert.ok(res.headers.get('access-control-allow-methods').includes('POST'));
  });

  await t.test('gzip 响应的页面能被正确解析', async () => {
    const r = await jsonRequest(srv.url('/v1/analyze'), {
      method: 'POST',
      body: { url: `${fixture.base}/gzip`, fast: true },
    });
    assert.equal(r.status, 200);
    assert.ok(r.json.data.page.title.includes('SEO'));
    assert.equal(r.json.data.page.httpCache.contentEncoding, 'gzip');
  });

  await t.test('重定向被跟随并记录', async () => {
    const r = await jsonRequest(srv.url('/v1/analyze'), {
      method: 'POST',
      body: { url: `${fixture.base}/redirect`, fast: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.page.redirects.length, 1);
    assert.equal(r.json.data.page.redirects[0].status, 301);
  });

  await t.test('404 目标站点仍返回报告但不报错', async () => {
    const r = await jsonRequest(srv.url('/v1/analyze'), {
      method: 'POST',
      body: { url: `${fixture.base}/404`, fast: true },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.page.status, 404);
    const statusCheck = r.json.data.checks.find((c) => c.id === 'http-status');
    assert.equal(statusCheck.status, 'fail');
  });

  await t.test('robots / llms / sitemap 被读取', async () => {
    // 默认测试实例关闭了辅助抓取以提速，这里单独起一个开启的实例
    const auxSrv = await startTestServer({
      security: { blockPrivateNetworks: false, allowHosts: [], denyHosts: [] },
      fetch: { fetchAuxiliary: true, timeoutMs: 5000 },
    });
    try {
      const r = await jsonRequest(auxSrv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
      assert.equal(r.status, 200);
      const aux = r.json.data.aux;
      assert.ok(aux, 'aux 不应为空');
      assert.equal(aux.robots.exists, true);
      assert.ok(aux.sitemap.urlCount >= 1);
      assert.ok(aux.llmsTxt, 'llms.txt 应被解析');
      assert.equal(aux.llmsTxt.links, 1);
      const llmsCheck = r.json.data.checks.find((c) => c.id === 'llms-txt');
      assert.equal(llmsCheck.status, 'pass');
      const robotsCheck = r.json.data.checks.find((c) => c.id === 'robots-txt');
      assert.equal(robotsCheck.status, 'pass');
    } finally {
      await auxSrv.stop();
    }
  });

  await t.test('静态资源不可穿越目录', async () => {
    for (const p of ['/assets/../../etc/passwd', '/icons/../../package.json', '/icons/%2e%2e%2f%2e%2e%2fpackage.json']) {
      const res = await fetch(srv.url(p));
      assert.ok([403, 404].includes(res.status), `${p} → ${res.status}`);
      const body = await res.text();
      assert.ok(!body.includes('"name": "seo2api"'));
    }
  });

  await t.test('响应带 request-id', async () => {
    const res = await fetch(srv.url('/health'));
    assert.ok(res.headers.get('x-request-id'));
  });

  await t.test('压缩生效', async () => {
    const res = await fetch(srv.url('/v1'), { headers: { 'accept-encoding': 'br, gzip' } });
    await res.text();
    assert.ok(['br', 'gzip'].includes(res.headers.get('content-encoding')));
  });

  await t.test('metrics 可导出', async () => {
    const res = await fetch(srv.url('/metrics'));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('seo2api_http_requests_total'));
  });
});
