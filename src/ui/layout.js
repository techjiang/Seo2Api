import { APP_CSS_VERSION } from './assets.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 作者与项目元信息，页脚、结构化数据、llms.txt 共用同一份 */
export const AUTHOR = {
  name: '科技酱',
  site: 'https://www.asoe.cn',
  docs: 'https://docs.asoe.cn',
  github: 'https://github.com/techjiang/',
  repo: 'https://github.com/techjiang/Seo2Api',
  email: 'official@tech.asoe.cn',
  bilibili: 'https://space.bilibili.com/1768832152',
  forum: 'https://forums.asoe.cn/',
};

const abs = (base, path) => `${String(base || '').replace(/\/+$/, '')}${path}`;

/**
 * 页面骨架。
 * 每页都带 canonical / og:url，因为「同一份 HTML 挂在多个入口」是本项目最常见的
 * 自 deploy 问题：不加 canonical，自己检测自己都会报重复内容。
 */
export function layout({
  title,
  description = '',
  body,
  cfg,
  version,
  active = '',
  bodyClass = '',
  path = '/',
  breadcrumb = null,
  extraJsonLd = [],
  noindex = false,
  scripts = [],
}) {
  const fullTitle = title ? `${title} · Seo2Api` : 'Seo2Api — 网站 SEO 检测与评分 API';
  const desc = description || '零依赖的网站 SEO 检测与评分 API：8 个维度 84 项检查，返回可复制的修复代码。';
  const canonical = abs(cfg.publicUrl, path);
  const ogImage = abs(cfg.publicUrl, '/icons/og-1200x630.png');

  const crumbs = breadcrumb || [{ name: '首页', path: '/' }];
  const graph = [
    {
      '@type': 'WebSite',
      '@id': abs(cfg.publicUrl, '/#website'),
      name: 'Seo2Api',
      url: abs(cfg.publicUrl, '/'),
      description: '零依赖的网站 SEO 检测与评分 API',
      inLanguage: 'zh-CN',
      publisher: { '@id': abs(cfg.publicUrl, '/#organization') },
    },
    {
      '@type': 'Organization',
      '@id': abs(cfg.publicUrl, '/#organization'),
      name: AUTHOR.name,
      url: AUTHOR.site,
      email: AUTHOR.email,
      logo: ogImage,
      sameAs: [AUTHOR.github, AUTHOR.bilibili, AUTHOR.docs],
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${canonical}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: c.name,
        item: abs(cfg.publicUrl, c.path),
      })),
    },
    {
      '@type': 'WebPage',
      '@id': `${canonical}#webpage`,
      url: canonical,
      name: fullTitle,
      description: desc,
      isPartOf: { '@id': abs(cfg.publicUrl, '/#website') },
      inLanguage: 'zh-CN',
    },
    ...extraJsonLd,
  ];

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b0f14">
<meta name="author" content="${esc(AUTHOR.name)}">
<meta name="robots" content="${noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="text/markdown" href="/llms.txt" title="llms.txt">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Seo2Api">
<meta property="og:locale" content="zh_CN">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Seo2Api — 网站 SEO 检测与评分 API">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(fullTitle)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(ogImage)}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
<link rel="stylesheet" href="/assets/app.css?v=${APP_CSS_VERSION}">
</head>
<body class="${esc(bodyClass)}">
<a class="skip-link" href="#main">跳到主内容</a>
<header class="site"><div class="wrap bar">
  <a class="brand" href="/"><img src="/favicon.svg" alt="Seo2Api Logo" width="26" height="26"><span>Seo<i>2</i>Api</span></a>
  <nav class="top" aria-label="主导航">
    <a href="/docs"${active === 'docs' ? ' style="color:var(--text)"' : ''}>文档</a>
    <a href="/v1">API</a>
    <a href="/health">状态</a>
    <a href="/llms.txt">llms.txt</a>
    <a href="${esc(AUTHOR.repo)}" rel="noopener">GitHub</a>
  </nav>
</div></header>
<main id="main"><div class="wrap">
${body}
</div></main>
<footer class="site"><div class="wrap">
  <span>Seo2Api v${esc(version)}</span>
  <span class="dim">·</span>
  <span>零依赖 · 单文件数据 · 8 维度 84 项检查</span>
  <span class="foot-links">
    <a href="${esc(AUTHOR.site)}" rel="noopener">科技酱</a> ·
    <a href="${esc(AUTHOR.repo)}" rel="noopener">源码</a> ·
    <a href="/docs">文档</a> ·
    <a href="/v1">API 索引</a> ·
    <a href="/llms.txt">llms.txt</a>
  </span>
</div></footer>
${scripts.map((src) => `<script src="${esc(src)}" defer></script>`).join('\n')}
</body>
</html>`;
}
