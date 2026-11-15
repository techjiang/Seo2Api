import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, assertHostAllowed } from '../src/core/netguard.js';
import { normalizeTarget, registrableDomain } from '../src/util/url.js';
import { parseRobotsTxt, isPathAllowed, parseSitemap, parseLlmsTxt } from '../src/core/aux.js';

const SECURITY = { blockPrivateNetworks: true, allowHosts: [], denyHosts: [] };

test('SSRF 地址判定', async (t) => {
  const priv = [
    '127.0.0.1', '127.255.255.255', '10.0.0.1', '10.255.255.255',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1',
  ];
  const pub = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700::1111'];

  for (const ip of priv) await t.test(`内网 ${ip}`, () => assert.equal(isPrivateAddress(ip), true));
  for (const ip of pub) await t.test(`公网 ${ip}`, () => assert.equal(isPrivateAddress(ip), false));
});

test('主机白名单/黑名单', async (t) => {
  await t.test('黑名单命中', async () => {
    await assert.rejects(
      assertHostAllowed('evil.com', { ...SECURITY, denyHosts: ['evil.com'] }, async () => [{ address: '8.8.8.8' }]),
      /黑名单/
    );
  });

  await t.test('黑名单含子域', async () => {
    await assert.rejects(
      assertHostAllowed('a.evil.com', { ...SECURITY, denyHosts: ['evil.com'] }, async () => [{ address: '8.8.8.8' }]),
      /黑名单/
    );
  });

  await t.test('白名单外拒绝', async () => {
    await assert.rejects(
      assertHostAllowed('other.com', { ...SECURITY, allowHosts: ['good.com'] }, async () => [{ address: '8.8.8.8' }]),
      /白名单/
    );
  });

  await t.test('白名单内放行', async () => {
    const r = await assertHostAllowed('sub.good.com', { ...SECURITY, allowHosts: ['good.com'] }, async () => [{ address: '8.8.8.8' }]);
    assert.equal(r.host, 'sub.good.com');
  });

  await t.test('DNS 解析到内网被拦截（防重绑定）', async () => {
    await assert.rejects(
      assertHostAllowed('rebind.example', SECURITY, async () => [{ address: '127.0.0.1' }]),
      /非公网|内网/
    );
  });

  await t.test('localhost / 单段主机名被拒绝', async () => {
    await assert.rejects(assertHostAllowed('localhost', SECURITY), /本机|内网/);
    await assert.rejects(assertHostAllowed('intranet', SECURITY), /不完整|本机|内网/);
    await assert.rejects(assertHostAllowed('metadata.google.internal', SECURITY), /本机|内网/);
  });

  await t.test('拒绝时给出可操作建议与结构化详情', async () => {
    const err = await assertHostAllowed('rebind.example', SECURITY, async () => [{ address: '10.1.2.3' }]).catch((e) => e);
    assert.equal(err.code, 'blocked_private_address');
    assert.equal(err.status, 403);
    assert.match(err.message, /SEO2API_ALLOW_PRIVATE/);
    assert.equal(err.extra.address, '10.1.2.3');
  });

  await t.test('关闭防护后不再拦截', async () => {
    const r = await assertHostAllowed('127.0.0.1', { ...SECURITY, blockPrivateNetworks: false });
    assert.equal(r.host, '127.0.0.1');
  });
});

test('URL 规范化与拒绝', async (t) => {
  await t.test('补全协议', () => {
    assert.equal(normalizeTarget('example.com').toString(), 'https://example.com/');
    assert.equal(normalizeTarget('//example.com').toString(), 'https://example.com/');
    assert.equal(normalizeTarget('http://example.com/a').toString(), 'http://example.com/a');
  });

  await t.test('去掉追踪参数', () => {
    const u = normalizeTarget('https://example.com/p?utm_source=x&id=1&gclid=y');
    assert.equal(u.searchParams.get('id'), '1');
    assert.equal(u.searchParams.has('utm_source'), false);
    assert.equal(u.searchParams.has('gclid'), false);
  });

  await t.test('去掉 hash', () => {
    assert.equal(normalizeTarget('https://example.com/a#top').hash, '');
  });

  await t.test('拒绝危险输入', () => {
    const bad = ['', '   ', 'ftp://a.com', 'javascript:alert(1)', 'file:///etc/passwd',
      'data:text/html,<script>', 'http://user:pw@a.com', 'http://', 'a..b', '<script>',
      'https://' + 'a'.repeat(3000)];
    for (const b of bad) {
      assert.throws(() => normalizeTarget(b), undefined, `应拒绝: ${b.slice(0, 40)}`);
    }
  });

  await t.test('注册域提取', () => {
    assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
    assert.equal(registrableDomain('www.example.com'), 'example.com');
    assert.equal(registrableDomain('example.com'), 'example.com');
    assert.equal(registrableDomain('1.2.3.4'), '1.2.3.4');
  });
});

test('robots.txt 解析', async (t) => {
  const txt = `# comment
User-agent: *
Disallow: /admin
Allow: /admin/public
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: BadBot
Disallow: /

Sitemap: https://x.com/sitemap.xml
Sitemap: https://x.com/sitemap2.xml`;

  await t.test('解析分组与规则', () => {
    const r = parseRobotsTxt(txt, '*');
    assert.equal(r.exists, true);
    assert.equal(r.rules.length, 3);
    assert.deepEqual(r.sitemaps, ['https://x.com/sitemap.xml', 'https://x.com/sitemap2.xml']);
    assert.equal(r.crawlDelay, 2);
  });

  await t.test('最长匹配优先', () => {
    const r = parseRobotsTxt(txt, '*');
    assert.equal(isPathAllowed(r, '/admin'), false);
    assert.equal(isPathAllowed(r, '/admin/public'), true);
    assert.equal(isPathAllowed(r, '/other'), true);
  });

  await t.test('通配符与结尾锚点', () => {
    const r = parseRobotsTxt(txt, '*');
    assert.equal(isPathAllowed(r, '/doc.pdf'), false);
    assert.equal(isPathAllowed(r, '/doc.pdfx'), true);
  });

  await t.test('特定 UA 分组覆盖通配', () => {
    const r = parseRobotsTxt(txt, 'BadBot');
    assert.equal(isPathAllowed(r, '/anything'), false);
  });

  await t.test('空 robots 全部允许', () => {
    const r = parseRobotsTxt('', '*');
    assert.equal(r.exists, false);
    assert.equal(isPathAllowed(r, '/x'), true);
  });

  await t.test('畸形输入不崩溃', () => {
    for (const bad of ['\u0000', 'Disallow', 'User-agent', ':::', 'a'.repeat(100000)]) {
      assert.doesNotThrow(() => parseRobotsTxt(bad, '*'));
    }
  });
});

test('sitemap 与 llms.txt 解析', async (t) => {
  await t.test('sitemap 索引识别', () => {
    const r = parseSitemap('<sitemapindex><sitemap><loc>https://x.com/a.xml</loc></sitemap></sitemapindex>');
    assert.equal(r.isIndex, true);
    assert.deepEqual(r.entries, ['https://x.com/a.xml']);
  });

  await t.test('sitemap 条目与 CDATA', () => {
    const r = parseSitemap('<urlset><url><loc><![CDATA[https://x.com/a]]></loc></url></urlset>');
    assert.deepEqual(r.entries, ['https://x.com/a']);
  });

  await t.test('sitemap 数量上限', () => {
    const many = '<urlset>' + Array.from({ length: 800 }, (_, i) => `<url><loc>https://x.com/${i}</loc></url>`).join('') + '</urlset>';
    const r = parseSitemap(many, { limit: 500 });
    assert.equal(r.entries.length, 500);
    assert.equal(r.truncated, true);
  });

  await t.test('llms.txt 结构', () => {
    const r = parseLlmsTxt('# Site\n> Summary text\n\n## Docs\n- [A](https://a.com): note\n- [B](https://b.com)\n');
    assert.equal(r.title, 'Site');
    assert.equal(r.summary, 'Summary text');
    assert.equal(r.linkCount, 2);
    assert.equal(r.sections[0].heading, 'Docs');
  });

  await t.test('llms.txt 空输入', () => {
    const r = parseLlmsTxt('');
    assert.equal(r.title, '');
    assert.equal(r.linkCount, 0);
  });
});
