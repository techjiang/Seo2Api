import { pass, warn, fail, info, cut, snippet } from './helpers.js';

export const socialRules = [
  {
    id: 'og-basic',
    dimension: 'social',
    severity: 'major',
    weight: 3,
    title: '配置 Open Graph 基础标签',
    description: 'og:title / og:description / og:type / og:url 决定链接在微信、Facebook、LinkedIn、Slack 里的卡片样式。',
    check: ({ page }) => {
      const required = ['title', 'description', 'type', 'url'];
      const missing = required.filter((k) => !page.og[k]);
      if (missing.length === 0) return pass('og:title / description / type / url 齐备。');
      if (missing.length === required.length) {
        return fail('完全没有 Open Graph 标签，分享出去只有裸链接。', {
          fix: snippet(`<meta property="og:type" content="website">
<meta property="og:title" content="${page.title || '页面标题'}">
<meta property="og:description" content="${page.description || '页面描述'}">
<meta property="og:url" content="${page.finalUrl}">
<meta property="og:image" content="https://example.com/og.png">`),
        });
      }
      return warn(`缺少 og:${missing.join('、og:')}。`, {
        fix: snippet(missing.map((k) => `<meta property="og:${k}" content="...">`).join('\n')),
      });
    },
  },
  {
    id: 'og-image',
    dimension: 'social',
    severity: 'major',
    weight: 2,
    title: '配置分享图 og:image',
    description: '带图的分享卡片点击率显著高于纯文本。建议 1200×630、小于 300KB。',
    check: ({ page }) => {
      const img = page.og.image || page.twitter.image;
      if (!img) {
        return fail('缺少 og:image，分享时不显示图片卡片。', {
          fix: snippet('<meta property="og:image" content="https://example.com/og-1200x630.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">'),
        });
      }
      if (!/^https?:\/\//i.test(img)) return warn(`og:image 不是绝对 URL：${cut(img, 80)}（部分平台不解析相对路径）。`);
      if (/^http:\/\//i.test(img)) return warn(`og:image 使用 http，部分平台会拒绝加载：${cut(img, 80)}。`);
      const missingSize = !page.og['image:width'] || !page.og['image:height'];
      if (missingSize) return warn('og:image 已配置但未声明 image:width/height，部分平台会延迟抓取或排版异常。');
      return pass(`og:image 已配置：${cut(img, 80)}`);
    },
  },
  {
    id: 'twitter-card',
    dimension: 'social',
    severity: 'minor',
    weight: 1.5,
    title: '配置 Twitter / X Card',
    description: 'twitter:card=summary_large_image 可在 X 上显示大图卡片，无需额外成本。',
    check: ({ page }) => {
      if (!page.twitter.card) return warn('未配置 twitter:card，X 上不会显示优化卡片。', {
        fix: snippet('<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="标题">\n<meta name="twitter:description" content="描述">\n<meta name="twitter:image" content="https://example.com/og.png">'),
      });
      if (!/summary_large_image|summary/i.test(page.twitter.card)) return warn(`twitter:card 值为「${cut(page.twitter.card, 30)}」，建议 summary_large_image。`);
      const missing = ['title', 'description'].filter((k) => !page.twitter[k] && !page.og[k]);
      if (missing.length) return warn(`twitter:card 已配置，但缺少 ${missing.map((m) => 'twitter:' + m).join('、')}（会回退到 og）。`);
      return pass(`twitter:card=${page.twitter.card}`);
    },
  },
  {
    id: 'og-locale',
    dimension: 'social',
    severity: 'minor',
    weight: 0.6,
    title: '声明 og:locale 与站点名',
    description: 'og:locale 帮助平台选择正确语言展示，og:site_name 让卡片显示品牌名。',
    check: ({ page }) => {
      const hasLocale = Boolean(page.og.locale);
      const hasSite = Boolean(page.og.site_name);
      if (hasLocale && hasSite) return pass('og:locale 与 og:site_name 均已配置。');
      const missing = [];
      if (!hasLocale) missing.push('og:locale');
      if (!hasSite) missing.push('og:site_name');
      return warn(`缺少 ${missing.join(' 与 ')}。`, {
        fix: snippet('<meta property="og:locale" content="zh_CN">\n<meta property="og:site_name" content="品牌名">'),
      });
    },
  },
  {
    id: 'favicon',
    dimension: 'social',
    severity: 'minor',
    weight: 1,
    title: 'Favicon 可访问',
    description: '浏览器标签页、书签、搜索结果都会展示站点图标。缺失会让站点显得不专业，也影响品牌识别。',
    check: ({ page, aux, auxFetched }) => {
      if (auxFetched === false) return info('快速模式未抓取 favicon，跳过检测。');
      if (aux?.faviconReachable === false) {
        return warn('favicon 无法访问（404 或超时）。', {
          fix: snippet('<link rel="icon" href="/favicon.svg" type="image/svg+xml">\n<link rel="icon" href="/favicon.ico" sizes="32x32">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">'),
        });
      }
      if (!page.favicons.length && aux?.faviconReachable !== true) return warn('页面未声明任何 icon link，也未检测到 /favicon.ico。');
      const hasSvg = page.favicons.some((f) => /svg/i.test(f.type) || /\.svg(\?|$)/i.test(f.href || ''));
      const hasApple = page.favicons.some((f) => /apple-touch/i.test(f.rel));
      if (!hasApple) return warn('缺少 apple-touch-icon，iOS 添加到主屏时图标会缺失。', {
        fix: snippet('<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">'),
      });
      return pass(`favicon 可访问${hasSvg ? '，含 SVG 版本' : ''}。`);
    },
  },
  {
    id: 'og-title-consistency',
    dimension: 'social',
    severity: 'minor',
    weight: 0.8,
    title: 'og:title 与页面 Title 一致',
    description: '两者差异过大时，用户从分享卡片点进来会感觉"进错页面"，跳出率升高。',
    check: ({ page }) => {
      if (!page.og.title || !page.title) return info('缺少 og:title 或 Title，跳过一致性检测。');
      const a = page.og.title.trim().toLowerCase();
      const b = page.title.trim().toLowerCase();
      if (a === b) return pass('og:title 与 Title 完全一致。');
      if (a.includes(b) || b.includes(a)) return pass('og:title 与 Title 高度相关。');
      return warn(`og:title「${cut(page.og.title, 40)}」与 Title「${cut(page.title, 40)}」差异较大。`);
    },
  },
];
