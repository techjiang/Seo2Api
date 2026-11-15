import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';

let counter = 0;

/** 每个测试用独立数据目录，避免相互污染 */
export function tempDataDir() {
  const dir = path.join(os.tmpdir(), `seo2api-test-${process.pid}-${++counter}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function startTestServer(overrides = {}) {
  const dataDir = overrides.dataDir || tempDataDir();
  const app = await createServer({
    dataDir,
    auth: { mode: 'none', adminToken: 'test-admin-token', defaultQuotaPerMin: 1000 },
    rateLimit: { max: 1000, burst: 100 },
    fetch: { fetchAuxiliary: false, timeoutMs: 5000 },
    ...overrides,
  });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    app,
    base,
    dataDir,
    url: (p) => `${base}${p}`,
    async stop() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function jsonRequest(url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: res.status, headers: res.headers, text, json };
}

/** 构造一个"什么都没配置"的最差页面 HTML，用于验证规则确实会失败 */
export function worstPageHtml() {
  return `<!doctype html>
<html><head></head><body>
<script src="/a.js"></script>
<img src="a.png">
<img src="b.png">
<a href="/x"></a>
</body></html>`;
}

/** 构造一个近乎完美的页面，用于验证规则不会误报 */
export function bestPageHtml(origin = 'https://good.example') {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>完整 SEO 指南：从零到上线 - 示例品牌</title>
<meta name="description" content="这是一份完整的 SEO 实施指南，覆盖内容、技术、性能、可访问性八个维度，包含 2024 年实测数据与可直接复制的配置示例。">
<link rel="canonical" href="${origin}/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="alternate" hreflang="zh-CN" href="${origin}/">
<link rel="alternate" hreflang="x-default" href="${origin}/">
<meta property="og:type" content="article">
<meta property="og:title" content="完整 SEO 指南：从零到上线 - 示例品牌">
<meta property="og:description" content="覆盖内容、技术、性能、可访问性八个维度。">
<meta property="og:url" content="${origin}/">
<meta property="og:image" content="${origin}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="zh_CN">
<meta property="og:site_name" content="示例品牌">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="完整 SEO 指南">
<meta name="twitter:description" content="八个维度 84 项检查。">
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","name":"示例品牌","url":"${origin}/","logo":"${origin}/logo.png"},
 {"@type":"WebSite","name":"示例品牌","url":"${origin}/"},
 {"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"首页","item":"${origin}/"}]},
 {"@type":"Article","headline":"完整 SEO 指南","datePublished":"2024-06-01"}
]}
</script>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
 {"@type":"Question","name":"什么是 SEO？","acceptedAnswer":{"@type":"Answer","text":"SEO 是让页面在搜索结果中更容易被发现的一系列技术与内容实践。"}}
]}
</script>
</head>
<body>
<a class="skip-link" href="#main">跳到主内容</a>
<header><nav><a href="/docs">文档</a> <a href="/blog">博客</a> <a href="/about">关于我们</a></nav></header>
<main id="main">
<article>
<h1>完整 SEO 指南：从零到上线</h1>
<p class="lede">Seo2Api 的这份指南把 SEO 拆成八个可度量的维度，每一项都给出阈值与修复方法。2024 年 6 月的实测数据显示，按此清单整改后平均分数提升了 34 分。</p>
<h2>什么是 SEO？</h2>
<p>SEO 是让页面在搜索结果中更容易被发现的一系列技术与内容实践的集合，目标是让搜索者更快找到正确答案。它的核心包括内容质量、技术规范、加载性能与可访问性四个方面。</p>
<h2>如何检查页面的 SEO 状况？</h2>
<p>检查 SEO 状况需要同时看抓取、索引、渲染与内容四个层面的数据，任何一层缺失都会让结论失真。最常见的做法是用工具跑一遍完整检查，再人工复核关键项。</p>
<h2>为什么 Canonical 标签很重要？</h2>
<p>Canonical 标签用于在多个相似 URL 之间指定权威版本，避免权重被重复内容分散。缺少它时，带参数链接与大小写变体会被视为不同页面，排名信号被稀释。</p>
<h3>具体实施步骤</h3>
<ul>
<li>确认每个页面都有唯一的 canonical 地址</li>
<li>让 canonical 指向最终 URL 而不是重定向中的 URL</li>
<li>确保 sitemap 与 canonical 保持一致</li>
</ul>
<h2>常见问题</h2>
<h3>SEO 多久能看到效果？</h3>
<p>通常需要 4 到 12 周，具体取决于站点历史、抓取频率与改动幅度。新站点往往需要更长时间，而权重较高的老站点在修复严重问题后可能在 2030 年之后的几个月内看到明显变化，这里以 8 周为典型基准。</p>
<p>根据 2024 年 3 月的行业调研，78% 的站点在完成基础整改后的第 6 周出现了排名改善，平均提升 12.5 个位次。</p>
</article>
<aside><h2>相关阅读</h2><a href="/blog/seo-basics">SEO 基础</a></aside>
</main>
<footer>© 2024 示例品牌</footer>
<form><label for="email">邮箱</label><input id="email" type="email" name="email"></form>
</body></html>`;
}
