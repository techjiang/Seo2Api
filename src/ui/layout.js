import { BASE_CSS } from './theme.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function layout({ title, description = '', body, cfg, version, active = '', bodyClass = '' }) {
  const fullTitle = title ? `${title} · Seo2Api` : 'Seo2Api — 网站 SEO 检测与评分 API';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || '零依赖的网站 SEO 检测与评分 API：8 个维度 84 项检查，返回可复制的修复代码。')}">
<meta name="theme-color" content="#0b0f14">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description || '零依赖的网站 SEO 检测与评分 API')}">
<meta property="og:image" content="${esc(cfg.publicUrl)}/icons/og-1200x630.png">
<meta property="og:locale" content="zh_CN">
<meta property="og:site_name" content="Seo2Api">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Seo2Api',
    url: cfg.publicUrl,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Linux, macOS, Windows',
    description: '零依赖的网站 SEO 检测与评分 API',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
  })}</script>
<style>${BASE_CSS}</style>
</head>
<body class="${esc(bodyClass)}">
<header class="site"><div class="wrap bar">
  <a class="brand" href="/"><img src="/favicon.svg" alt="Seo2Api Logo" width="26" height="26"><span>Seo<i>2</i>Api</span></a>
  <nav class="top">
    <a href="/docs"${active === 'docs' ? ' style="color:var(--text)"' : ''}>文档</a>
    <a href="/v1">API</a>
    <a href="/health">状态</a>
    <a href="/llms.txt">llms.txt</a>
  </nav>
</div></header>
<main><div class="wrap">
${body}
</div></main>
<footer class="site"><div class="wrap">
  <span>Seo2Api v${esc(version)}</span>
  <span class="dim">·</span>
  <span>零依赖 · 单文件数据 · 8 维度 84 项检查</span>
  <span style="margin-left:auto"><a href="/docs">文档</a> · <a href="/v1">API 索引</a> · <a href="/llms.txt">llms.txt</a></span>
</div></footer>
</body>
</html>`;
}
