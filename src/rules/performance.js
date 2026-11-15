import { pass, warn, fail, info, atMost, atLeast, cut, snippet } from './helpers.js';

const KB = 1024;

export const performanceRules = [
  {
    id: 'html-size',
    dimension: 'performance',
    severity: 'major',
    weight: 2,
    title: 'HTML 文档体积合理',
    description: 'HTML 是渲染的起点，超过 100KB 的 HTML 通常意味着内联数据过多。压缩后应在 100KB 以内。',
    check: ({ page }) => {
      const kb = page.htmlBytes / KB;
      const level = atMost(kb, 100, 200);
      if (level === 'pass') return pass(`HTML 体积 ${kb.toFixed(1)}KB，轻量。`);
      if (level === 'warn') return warn(`HTML 体积 ${kb.toFixed(1)}KB，偏大，建议精简内联脚本与数据。`);
      return fail(`HTML 体积 ${kb.toFixed(1)}KB，过大，建议拆分或外置内联内容。`, {
        fix: snippet('<!-- 把内联的 JSON 数据改为按需请求 -->\n<script src="/data/page.js" defer></script>'),
      });
    },
  },
  {
    id: 'render-blocking',
    dimension: 'performance',
    severity: 'major',
    weight: 2.5,
    title: '无阻塞渲染的脚本',
    description: '同步 <script> 会阻塞 HTML 解析，直接拖慢首屏（FCP）。除必要的外，都应加 defer 或 async。',
    check: ({ page }) => {
      const n = page.blockingScripts.length;
      if (n === 0) return pass('所有脚本均为 async / defer 或内联非阻塞。');
      // 内联脚本可能有很多个，去重后再说，否则会出现"内联脚本、内联脚本、内联脚本"
      const samples = [...new Set(page.blockingScripts.slice(0, 6).map((s) => {
        if (!s.src) return '内联脚本';
        try { return new URL(s.src).host + new URL(s.src).pathname; } catch { return s.src; }
      }))].slice(0, 3);
      if (n <= 2) return warn(`${n} 个同步脚本会阻塞解析：${samples.join('、')}。`, { fix: snippet('<script src="/app.js" defer></script>') });
      return fail(`${n} 个同步脚本会阻塞解析：${samples.slice(0, 3).join('、')}。`, {
        fix: snippet('<script src="/vendor.js" defer></script>\n<script src="/app.js" defer></script>'),
      });
    },
  },
  {
    id: 'image-alt-and-dims',
    dimension: 'performance',
    severity: 'major',
    weight: 2,
    title: '图片声明尺寸避免布局偏移',
    description: '未设置 width/height 的图片加载时会引起 CLS（累积布局偏移），这是 Core Web Vitals 的核心指标。',
    check: ({ page }) => {
      if (!page.images.length) return info('页面无图片。');
      const noDim = page.imagesNoDim.length;
      const ratio = noDim / page.images.length;
      if (noDim === 0) return pass(`全部 ${page.images.length} 张图片都声明了尺寸。`);
      if (ratio < 0.3) return warn(`${noDim}/${page.images.length} 张图片缺少 width/height，可能引起布局偏移。`, { fix: snippet('<img src="/a.png" width="800" height="450" alt="说明">') });
      return fail(`${noDim}/${page.images.length} 张图片缺少宽高，CLS 风险高。`, {
        fix: snippet('<img src="/a.png" width="800" height="450" loading="lazy" alt="说明">'),
      });
    },
  },
  {
    id: 'image-modern-format',
    dimension: 'performance',
    severity: 'minor',
    weight: 1.2,
    title: '图片使用现代格式或响应式',
    description: 'WebP/AVIF 比 JPEG/PNG 小 25–50%；srcset 可按屏幕提供合适尺寸。',
    check: ({ page }) => {
      if (!page.images.length) return info('页面无图片。');
      const modern = page.images.filter((i) => i.src && /\.(webp|avif)(\?|$)/i.test(i.src));
      const legacy = page.images.filter((i) => i.src && /\.(jpe?g|png|gif)(\?|$)/i.test(i.src));
      const responsive = page.images.filter((i) => i.srcset).length;
      if (legacy.length === 0 && modern.length === 0) return info('图片 URL 无扩展名，无法判断格式。');
      const rate = modern.length / Math.max(1, modern.length + legacy.length);
      if (rate >= 0.6) return pass(`现代格式占比 ${(rate * 100).toFixed(0)}%。`);
      if (responsive > page.images.length * 0.5) return pass(`大量图片使用 srcset 响应式加载（${responsive} 张）。`);
      return warn(`含 ${legacy.length} 张 JPEG/PNG 图片，可转换为 WebP/AVIF 或使用 <picture>。`, {
        fix: snippet('<picture>\n  <source srcset="/img/a.avif" type="image/avif">\n  <img src="/img/a.webp" alt="说明" width="800" height="450">\n</picture>'),
      });
    },
  },
  {
    id: 'lazy-loading',
    dimension: 'performance',
    severity: 'minor',
    weight: 1,
    title: '首屏外图片延迟加载',
    description: 'loading="lazy" 让浏览器跳过视口外的图片请求，显著降低首屏带宽竞争。首图不要加。',
    check: ({ page }) => {
      if (page.images.length < 5) return info('图片较少，延迟加载收益有限。');
      const lazy = page.imagesLazy.length;
      if (lazy === 0) return warn(`${page.images.length} 张图片都没有 loading="lazy"。`, { fix: snippet('<img src="/a.png" loading="lazy" alt="说明">') });
      if (lazy / page.images.length < 0.5) return warn(`仅 ${lazy}/${page.images.length} 张图片使用了延迟加载。`);
      return pass(`${lazy}/${page.images.length} 张图片使用了延迟加载。`);
    },
  },
  {
    id: 'compression',
    dimension: 'performance',
    severity: 'major',
    weight: 2,
    title: '启用了传输压缩',
    description: 'gzip / brotli 可把 HTML、CSS、JS 压缩 60–80%。未压缩是性价比最高的性能问题。',
    check: ({ page }) => {
      const enc = page.negotiated.contentEncoding;
      if (!enc) {
        return warn('响应未使用 Content-Encoding，请开启 gzip 或 brotli。', {
          fix: snippet('# Nginx\ngzip on;\ngzip_types text/html text/css application/javascript application/json;'),
        });
      }
      if (/br/.test(enc)) return pass(`已使用 brotli 压缩（${enc}）。`);
      if (/gzip|deflate|zstd/.test(enc)) return pass(`已启用压缩（${enc}）。`);
      return warn(`未知压缩方式：${enc}。`);
    },
  },
  {
    id: 'http-caching',
    dimension: 'performance',
    severity: 'minor',
    weight: 1.2,
    title: '设置了缓存策略',
    description: 'Cache-Control / ETag / Last-Modified 让回访用户和 CDN 命中缓存，减少重复下载。',
    check: ({ page }) => {
      const cc = page.negotiated.cacheControl;
      if (cc && /no-store|no-cache/i.test(cc)) return warn(`Cache-Control 为「${cut(cc, 60)}」，完全禁用缓存会影响回访性能。`);
      if (cc && /(max-age=[1-9]|s-maxage|immutable|public)/i.test(cc)) return pass(`Cache-Control：${cut(cc, 60)}`);
      if (page.negotiated.etag || page.negotiated.lastModified) return pass('使用 ETag / Last-Modified 协商缓存。');
      return warn('未发现 Cache-Control / ETag / Last-Modified。', {
        fix: snippet('# Nginx\nadd_header Cache-Control "public, max-age=3600";'),
      });
    },
  },
  {
    id: 'preconnect-hints',
    dimension: 'performance',
    severity: 'minor',
    weight: 0.8,
    title: '第三方域名使用资源提示',
    description: '对关键第三方域名（CDN、字体、统计）使用 preconnect / dns-prefetch，可省下 100–300ms 的握手时间。',
    check: ({ page }) => {
      const hosts = page.stats.externalHosts.filter((h) => h !== new URL(page.finalUrl).hostname);
      const hints = page.resourceHints;
      const total = hints.preconnect + hints.dnsPrefetch;
      if (hosts.length === 0) return pass('未引用第三方域名，无需资源提示。');
      if (total === 0) return warn(`引用了 ${hosts.length} 个第三方域名但未使用 preconnect/dns-prefetch。`, {
        fix: snippet('<link rel="preconnect" href="https://cdn.example.com" crossorigin>'),
      });
      if (total < Math.min(3, hosts.length)) return warn(`仅 ${total} 条资源提示，覆盖 ${hosts.length} 个第三方域名。`);
      return pass(`使用了 ${total} 条 preconnect / dns-prefetch。`);
    },
  },
  {
    id: 'async-css',
    dimension: 'performance',
    severity: 'minor',
    weight: 0.8,
    title: '非关键 CSS 未阻塞渲染',
    description: '过多 <link rel="stylesheet"> 会串行阻塞渲染。非关键样式可用 media 或 preload 异步加载。',
    check: ({ page }) => {
      const n = page.stylesheets.length;
      if (n === 0) return info('未引用外部样式表（可能是内联或纯静态页）。');
      if (n <= 3) return pass(`引用 ${n} 个样式表，数量可控。`);
      if (n <= 6) return warn(`引用 ${n} 个样式表，建议合并或异步加载非关键 CSS。`);
      return fail(`引用 ${n} 个样式表，会明显阻塞首屏。`, { fix: snippet('<link rel="preload" href="/non-critical.css" as="style" onload="this.rel=\'stylesheet\'">') });
    },
  },
  {
    id: 'inline-bloat',
    dimension: 'performance',
    severity: 'minor',
    weight: 1,
    title: '内联脚本与样式不臃肿',
    description: '大量内联代码无法被缓存，每次请求都重复传输。超过 50KB 就应外置。',
    check: ({ page }) => {
      const total = page.inlineScriptBytes + page.inlineStyleBytes;
      const kb = total / KB;
      if (kb < 20) return pass(`内联脚本+样式 ${kb.toFixed(1)}KB，合理。`);
      if (kb < 50) return warn(`内联脚本+样式 ${kb.toFixed(1)}KB，建议外置以利用缓存。`);
      return fail(`内联脚本+样式 ${kb.toFixed(1)}KB，体积过大。`, { fix: snippet('<script src="/app.js" defer></script>\n<link rel="stylesheet" href="/app.css">') });
    },
  },
  {
    id: 'font-display',
    dimension: 'performance',
    severity: 'minor',
    weight: 0.8,
    title: '自定义字体使用 font-display',
    description: '没有 font-display 的自定义字体在加载完成前会"隐身"，造成文字不可见（FOIT），约 3 秒。',
    check: ({ page }) => {
      if (!/@font-face/i.test(page.fontDisplayMissing ? 'x' : '') && !page.fontDisplayMissing) return info('未检测到 @font-face 或已配置 font-display。');
      return warn('@font-face 未配置 font-display，可能导致文字闪烁或不可见。', {
        fix: snippet('@font-face {\n  font-family: "Brand";\n  src: url("/f.woff2") format("woff2");\n  font-display: swap;\n}'),
      });
    },
  },
  {
    id: 'ttfb-proxy',
    dimension: 'performance',
    severity: 'major',
    weight: 1.5,
    title: '服务端响应速度',
    description: '这里测的是 HTML 下载总耗时（含 TLS 握手与传输），可作为 TTFB 的粗略代理。超过 1 秒体验明显下降。',
    check: ({ page }) => {
      // 扣除"报告生成"本身，只用抓取耗时
      const ms = page.elapsedMs || 0;
      if (ms === 0) return info('未获取到响应耗时。');
      if (ms < 400) return pass(`响应耗时 ${ms}ms，很快。`);
      if (ms < 800) return pass(`响应耗时 ${ms}ms，正常。`);
      if (ms < 1500) return warn(`响应耗时 ${ms}ms，偏慢，建议检查服务端渲染与 CDN。`);
      return fail(`响应耗时 ${ms}ms，过慢，直接影响 Core Web Vitals。`, {
        fix: snippet('# 建议：启用 CDN + 服务端缓存 + 减少首字节前的串行请求'),
      });
    },
  },
  {
    id: 'iframe-heavy',
    dimension: 'performance',
    severity: 'minor',
    weight: 0.6,
    title: 'iframe 数量可控',
    description: '每个 iframe 都是独立的文档加载上下文，过多会显著增加主线程与网络负担。',
    check: ({ page }) => {
      const n = page.iframes.length;
      if (n === 0) return pass('页面无 iframe。');
      const lazy = page.iframes.filter((f) => f.loading === 'lazy').length;
      if (n > 5) return warn(`页面有 ${n} 个 iframe，建议改为按需加载（仅 ${lazy} 个使用 lazy）。`);
      if (n > 2 && lazy === 0) return warn(`有 ${n} 个 iframe 且均未延迟加载。`, { fix: snippet('<iframe src="/embed" loading="lazy" title="嵌入内容"></iframe>') });
      return pass(`iframe 数量 ${n}，可接受。`);
    },
  },
];
