import { pass, warn, fail, info, cut, snippet } from './helpers.js';
import { isPathAllowed } from '../core/aux.js';

export const discoverabilityRules = [
  {
    id: 'robots-txt',
    dimension: 'discoverability',
    severity: 'major',
    weight: 2.5,
    title: 'robots.txt 存在且有效',
    description: 'robots.txt 是爬虫访问的第一个文件，用于声明抓取范围与 sitemap 位置。缺失时所有路径都默认可抓。',
    check: ({ aux }) => {
      if (!aux?.robots) return warn('未找到 robots.txt（或缺省返回空内容）。建议创建以声明 sitemap 与抓取规则。', { fix: snippet('User-agent: *\nAllow: /\n\nSitemap: https://example.com/sitemap.xml') });
      if (!aux.robots.exists) return warn('robots.txt 内容为空。', { fix: snippet('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml') });
      return pass(`robots.txt 存在，包含 ${aux.robots.rules.length} 条规则、${aux.robots.sitemaps.length} 个 sitemap 声明。`);
    },
  },
  {
    id: 'robots-allows-page',
    dimension: 'discoverability',
    severity: 'critical',
    weight: 3,
    title: 'robots.txt 未屏蔽当前页面',
    description: '页面被 robots.txt 的 Disallow 命中时，搜索引擎不会抓取，自然不会收录（也不会传递任何权重）。',
    check: ({ page, aux, cfg }) => {
      if (!aux?.robots) return info('无 robots.txt，默认允许抓取。');
      let pathname = '/';
      let search = '';
      try { const u = new URL(page.finalUrl); pathname = u.pathname; search = u.search; } catch { /* ignore */ }
      const allowed = isPathAllowed(aux.robots, pathname, search);
      if (allowed) return pass(`路径 ${pathname} 未被 robots.txt 屏蔽。`);
      return fail(`路径 ${pathname} 被 robots.txt 屏蔽（匹配规则见 details），无法被抓取。`, {
        details: aux.robots.rules.slice(0, 5).map((r) => `${r.type}: ${r.path}`),
        fix: snippet('User-agent: *\nAllow: /\nDisallow: /admin\n# 确认目标页面不在 Disallow 范围内'),
      });
    },
  },
  {
    id: 'sitemap',
    dimension: 'discoverability',
    severity: 'major',
    weight: 2,
    title: 'Sitemap 可访问',
    description: 'sitemap.xml 帮助搜索引擎快速发现全站 URL，尤其是有深层目录或较少外链的站点。',
    check: ({ aux }) => {
      if (!aux?.sitemap) {
        return warn(`未找到可访问的 sitemap（检查过 ${aux?.sitemapUrl || '/sitemap.xml'}）。`, {
          fix: snippet('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://example.com/</loc></url>\n</urlset>'),
        });
      }
      const n = aux.sitemap.entries.length;
      if (aux.sitemap.isIndex) return pass(`Sitemap 索引可访问，包含 ${n} 个子 sitemap。`);
      if (n === 0) return warn('Sitemap 存在但没有任何 URL 条目。');
      return pass(`Sitemap 可访问，包含 ${n} 个 URL。`);
    },
  },
  {
    id: 'page-in-sitemap',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 1,
    title: '当前页面在 Sitemap 中',
    description: '确保重要页面被收录进 sitemap，能显著加快被发现的速度。',
    check: ({ aux }) => {
      if (!aux?.sitemap) return info('无 sitemap，跳过检测。');
      if (aux.pageInSitemap === null) return info('sitemap 为索引形式，无法直接判断。');
      if (aux.pageInSitemap) return pass('当前页面已在 sitemap 中。');
      return warn('当前页面不在 sitemap 的 URL 列表里（可能列表被截断，仅检测前 500 条）。');
    },
  },
  {
    id: 'internal-links',
    dimension: 'discoverability',
    severity: 'major',
    weight: 2,
    title: '内链数量充足',
    description: '内链传递权重、帮助爬虫发现深层页面、也帮助用户继续浏览。内容页面建议至少 3 条有意义的站内链接。',
    check: ({ page }) => {
      const n = page.internalLinks.filter((l) => l.text.length > 0).length;
      if (n === 0) return fail('没有任何带锚文本的站内链接，是典型的"孤岛页面"。', { fix: snippet('<a href="/related">相关内容</a>') });
      if (n < 3) return warn(`仅 ${n} 条站内链接，偏少。`);
      if (n > 200) return warn(`站内链接 ${n} 条，过多可能稀释单页权重。`);
      return pass(`站内链接 ${n} 条。`);
    },
  },
  {
    id: 'link-text-quality',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 1,
    title: '链接锚文本有意义',
    description: '「点击这里」「更多」这类锚文本不传递主题信息。描述性锚文本对 SEO 和可访问性都有帮助。',
    check: ({ page }) => {
      const bad = page.links.filter((l) => l.internal && /^(点击这里|这里|更多|详情|了解更多|click here|here|more|read more|link)$/i.test(l.text.trim()));
      if (bad.length === 0) return pass('未发现无意义锚文本。');
      if (bad.length <= 2) return warn(`${bad.length} 处锚文本过于笼统：「${bad[0].text}」。`);
      return warn(`${bad.length} 处锚文本过于笼统（如「${bad[0].text}」），建议描述目标内容。`, {
        fix: snippet('<a href="/seo-guide">完整的 SEO 优化指南</a>'),
      });
    },
  },
  {
    id: 'no-broken-hash',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 0.6,
    title: '无空锚或 JavaScript 伪链接',
    description: 'href="#" 或 javascript:void(0) 无法被爬虫跟随，真正的链接应指向可访问的 URL。',
    check: ({ page }) => {
      const junk = page.links.filter((l) => l.raw === '#' || /^javascript:/i.test(l.raw));
      if (junk.length === 0) return pass('未发现空锚或 javascript 伪链接。');
      if (junk.length <= 3) return warn(`${junk.length} 个 href="#" / javascript: 伪链接。`);
      return warn(`${junk.length} 个伪链接，建议改为 <button> 或真实 URL。`);
    },
  },
  {
    id: 'hreflang',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 1,
    title: '多语言页面配置 hreflang',
    description: '若站点有多语言版本，hreflang 可让不同地区的用户看到正确语言版本，避免互相竞争。单语言站点无需配置。',
    check: ({ page }) => {
      const list = page.hreflangs;
      if (!list.length) {
        const multiLangSignals = /\/en\/|\/zh\/|\/ja\/|\/de\//.test(new URL(page.finalUrl).pathname);
        if (multiLangSignals) {
          return warn('URL 呈现多语言特征但未配置 hreflang。', {
            fix: snippet('<link rel="alternate" hreflang="en" href="https://example.com/en/">\n<link rel="alternate" hreflang="zh-CN" href="https://example.com/zh/">\n<link rel="alternate" hreflang="x-default" href="https://example.com/">'),
          });
        }
        return info('未配置 hreflang（单语言站点可忽略）。');
      }
      const langs = list.map((l) => l.lang);
      const hasDefault = langs.includes('x-default');
      const hasSelf = list.some((l) => l.href && l.href.replace(/\/$/, '') === page.finalUrl.replace(/\/$/, ''));
      const issues = [];
      if (!hasSelf) issues.push('未包含指向自身的 hreflang');
      if (!hasDefault) issues.push('缺少 x-default');
      if (issues.length) return warn(`hreflang 有 ${langs.length} 条但${issues.join('、')}。`);
      return pass(`hreflang 配置完整（${langs.length} 种语言）。`);
    },
  },
  {
    id: 'canonical-chain',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 0.8,
    title: 'Canonical 与 hreflang 不冲突',
    description: 'canonical 指向 A 而 hreflang 指向 B，会让搜索引擎收到矛盾信号，可能导致版本选择错误。',
    check: ({ page }) => {
      if (!page.canonical || !page.hreflangs.length) return info('未同时使用 canonical 与 hreflang，跳过冲突检测。');
      const conflict = page.hreflangs.find((l) => l.lang !== 'x-default' && l.href === page.finalUrl) ;
      if (conflict && page.canonicalIsSelf === false) {
        return warn('canonical 指向其它 URL，但 hreflang 把当前页当作某语言的版本，信号冲突。');
      }
      return pass('canonical 与 hreflang 未发现冲突。');
    },
  },
  {
    id: 'nofollow-balance',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 0.6,
    title: '外链出站策略合理',
    description: '正常引用权威站点是加分项，但大量无 nofollow 的付费/不可信外链有风险。',
    check: ({ page }) => {
      const ext = page.externalLinks;
      if (ext.length === 0) return info('页面无外部链接。');
      const nf = ext.filter((l) => l.nofollow).length;
      if (ext.length > 30 && nf === 0) return warn(`有 ${ext.length} 条外链但全部未加 nofollow，建议对非背书链接加 rel="nofollow noopener"。`);
      return pass(`外链 ${ext.length} 条，其中 ${nf} 条为 nofollow。`);
    },
  },
  {
    id: 'external-links-safe',
    dimension: 'discoverability',
    severity: 'minor',
    weight: 0.5,
    title: '新窗口外链带 noopener',
    description: 'target="_blank" 不带 rel="noopener" 会让新页面通过 window.opener 操控原页面（钓鱼风险）。',
    check: ({ page }) => {
      const risky = page.links.filter((l) => l.target === '_blank' && !/noopener|noreferrer/.test(l.rel));
      if (risky.length === 0) return pass('所有新窗口链接都带了 noopener。');
      return warn(`${risky.length} 个 target="_blank" 链接缺少 rel="noopener"。`, {
        fix: snippet('<a href="https://ext.com" target="_blank" rel="noopener noreferrer">外部链接</a>'),
      });
    },
  },
];
