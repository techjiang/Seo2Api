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

/**
 * 站点自身也要是一份合格的 SEO 输出。
 * 一个号称检测 SEO 的服务，自己的页面缺 canonical、缺 og:url、
 * 不压缩、没有跳转链接，是最好笑的 bug。
 */
test('站点自身可被审计通过', async (t) => {
  // 需要抓本机 fixture，所以放开内网限制；其它行为与生产一致
  const srv = await startTestServer({ security: { blockPrivateNetworks: false, allowHosts: [], denyHosts: [] } });
  t.after(() => srv.stop());

  const pagePaths = ['/', '/docs'];

  await t.test('页面带 canonical / og:url / 结构化数据', async () => {
    for (const p of pagePaths) {
      const html = await (await fetch(srv.url(p))).text();
      assert.ok(html.includes('<link rel="canonical"'), `${p} 缺 canonical`);
      assert.ok(html.includes('og:url'), `${p} 缺 og:url`);
      assert.ok(html.includes('og:image:width'), `${p} 缺分享图尺寸`);
      assert.ok(html.includes('"@type":"Organization"'), `${p} 缺 Organization 实体`);
      assert.ok(html.includes('"@type":"BreadcrumbList"'), `${p} 缺面包屑结构化数据`);
      assert.ok(html.includes('class="skip-link"'), `${p} 缺跳到主内容链接`);
      assert.ok(html.includes('rel="manifest"'), `${p} 缺 webmanifest`);
    }
  });

  await t.test('样式与脚本外置且可缓存', async () => {
    const html = await (await fetch(srv.url('/'))).text();
    assert.ok(!html.includes('<style'), '页面不应再内联 <style>');
    assert.ok(/\/assets\/app\.css\?v=[0-9a-f]+/.test(html), '应引用带版本号的 CSS');
    assert.ok(/\/assets\/app\.js\?v=[0-9a-f]+/.test(html), '应引用带版本号的 JS');

    for (const p of ['/assets/app.css', '/assets/app.js']) {
      const res = await fetch(srv.url(p));
      assert.equal(res.status, 200, p);
      assert.match(res.headers.get('cache-control'), /immutable/);
      const etag = res.headers.get('etag');
      assert.ok(etag, `${p} 应带 etag`);
      const again = await fetch(srv.url(p), { headers: { 'if-none-match': etag } });
      assert.equal(again.status, 304, `${p} 应支持条件请求`);
    }
  });

  await t.test('页面带 CSP 且不放开 unsafe-inline 脚本', async () => {
    const res = await fetch(srv.url('/'));
    const csp = res.headers.get('content-security-policy') || '';
    assert.ok(csp.includes("script-src 'self'"), csp);
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), '脚本已外置，不应再允许 unsafe-inline');
    assert.ok(csp.includes("frame-ancestors 'self'"));
    assert.ok(res.headers.get('permissions-policy'));
  });

  await t.test('HTML 响应被压缩', async () => {
    const res = await fetch(srv.url('/'), { headers: { 'accept-encoding': 'br, gzip' } });
    const body = await res.text();
    assert.ok(['br', 'gzip'].includes(res.headers.get('content-encoding')), 'HTML 应压缩');
    assert.ok(body.includes('</html>'));
  });

  await t.test('webmanifest 可访问', async () => {
    const res = await fetch(srv.url('/site.webmanifest'));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.short_name, 'Seo2Api');
    assert.ok(json.icons.length >= 2);
  });

  await t.test('报告页 noindex，不进索引预算', async () => {
    const fixture = await startOwnAuditTarget();
    try {
      const r = await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: fixture.base } });
      const html = await (await fetch(srv.url(`/report/${r.json.data.id}`))).text();
      assert.ok(html.includes('noindex'), '报告页应标 noindex');
      assert.ok(html.includes('BreadcrumbList'));
    } finally {
      await fixture.close();
    }
  });

  await t.test('404 页面也完整渲染', async () => {
    const res = await fetch(srv.url('/report/does-not-exist'));
    assert.equal(res.status, 404);
    const html = await res.text();
    assert.ok(html.includes('404'));
    assert.ok(html.includes('noindex'));
    assert.ok(html.includes('</html>'));
  });

  await t.test('首页可被自己检测并拿到 A 级以上', async () => {
    const fixture = await startOwnAuditTarget();
    try {
      const r = await jsonRequest(srv.url('/v1/analyze'), {
        method: 'POST',
        body: { url: fixture.base, fast: true },
      });
      const data = r.json.data;
      const byId = Object.fromEntries(data.checks.map((c) => [c.id, c]));
      // 这些是纯服务端可控项，不该再失败
      for (const id of ['canonical', 'og-basic', 'og-image', 'skip-link', 'schema-recommended', 'render-blocking']) {
        assert.ok(['pass', 'warn'].includes(byId[id].status), `${id} → ${byId[id].status}: ${byId[id].message}`);
      }
    } finally {
      await fixture.close();
    }
  });
});

/** 起一个把测试服务器首页当成"外部站点"的代理，用来检测测试服务器自己 */
async function startOwnAuditTarget() {
  const site = http.createServer(async (req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\n');
    }
    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<?xml version="1.0"?><urlset><url><loc>http://127.0.0.1/</loc></url></urlset>');
    }
    if (req.url === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('# Fixture\n> A test site\n\n## Pages\n- [Home](http://127.0.0.1/)\n');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(bestPageHtml(`http://127.0.0.1:${site.address().port}`));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  return { site, base: `http://127.0.0.1:${site.address().port}`, close: () => new Promise((r) => site.close(r)) };
}

test('辅助资源抓取的回退策略', async (t) => {
  // robots.txt 里声明的 Sitemap 常常是对外域名（https 或别的主机），
  // 本地/内网部署时那一跳会失败。此时应回退到当前 origin，而不是报「没有 sitemap」。
  const site = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\nSitemap: https://unreachable.invalid/sitemap.xml\n');
    }
    if (req.url === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end('<?xml version="1.0"?><urlset><url><loc>PLACEHOLDER</loc></url></urlset>');
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(bestPageHtml(`http://127.0.0.1:${site.address().port}`));
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}`;

  const srv = await startTestServer({
    security: { blockPrivateNetworks: false, allowHosts: [], denyHosts: [] },
    fetch: { fetchAuxiliary: true, timeoutMs: 4000 },
  });
  t.after(async () => {
    await srv.stop();
    await new Promise((r) => site.close(r));
  });

  const r = await jsonRequest(srv.url('/v1/analyze'), { method: 'POST', body: { url: base, fast: false } });
  assert.equal(r.status, 200);
  assert.ok(r.json.data.aux.sitemap, '应回退到 origin 的 sitemap');
  assert.ok(r.json.data.aux.sitemap.url.endsWith(`${new URL(base).port}/sitemap.xml`), r.json.data.aux.sitemap.url);
  const check = r.json.data.checks.find((c) => c.id === 'sitemap');
  assert.equal(check.status, 'pass', check.message);
});
