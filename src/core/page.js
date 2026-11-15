import { parseHtml, countWords, countSentences, decodeEntities } from './html.js';
import { resolveUrl, registrableDomain, isSameOrigin } from '../util/url.js';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;

const stripTagsDeep = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** 提取 meta name/property → content，键统一小写 */
function metaIndex(doc) {
  const map = new Map();
  for (const attrs of doc.meta()) {
    const key = (attrs.name || attrs.property || attrs['http-equiv'] || '').toLowerCase().trim();
    if (!key) continue;
    if (!map.has(key)) map.set(key, attrs.content ?? '');
    if (attrs.property && !map.has(attrs.property.toLowerCase())) map.set(attrs.property.toLowerCase(), attrs.content ?? '');
  }
  return map;
}

/** 简易中英文关键词提取：英文按词，中文按 2-gram */
export function extractKeywords(text, limit = 12) {
  const lower = String(text || '').toLowerCase();
  const stop = new Set([
    'the','a','an','and','or','but','if','then','of','to','in','on','at','for','with','is','are','was','were','be','been',
    'this','that','these','those','it','its','as','by','from','we','you','your','our','they','their','he','she','his','her',
    'will','can','could','should','would','may','might','not','no','do','does','did','has','have','had','also','more','most',
    'than','so','up','out','about','into','over','after','before','when','where','which','who','what','how','why','all','any',
    '的','了','和','是','在','我','有','就','不','人','都','一','一个','上','也','很','到','说','要','去','你','会','着',
    '没有','看','好','自己','这','那','他','她','它','我们','你们','他们','这个','那个','什么','怎么','因为','所以','但是',
    '而且','如果','可以','以及','还有','进行','通过','对于','关于','已经','需要','使用','提供','如何','我们','非常',
  ]);
  const counts = new Map();
  const bump = (k, w = 1) => {
    if (k.length < 2 || stop.has(k)) return;
    counts.set(k, (counts.get(k) || 0) + w);
  };
  const latin = lower.replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ');
  for (const w of latin.split(/[^\p{L}\p{N}'’-]+/u)) {
    if (w.length >= 2 && w.length <= 24 && !/^\d+$/.test(w)) bump(w);
  }
  const cjkRuns = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]+/g) || [];
  for (const run of cjkRuns) {
    for (let i = 0; i + 1 < run.length; i++) bump(run.slice(i, i + 2));
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count }));
}

function parseJsonLd(scripts) {
  const blocks = [];
  const types = new Set();
  const walk = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 8) return;
    if (Array.isArray(obj)) { for (const x of obj) walk(x, depth + 1); return; }
    const t = obj['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    if (obj['@graph']) walk(obj['@graph'], depth + 1);
    for (const v of Object.values(obj)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  for (const s of scripts) {
    const raw = s.text.trim();
    if (!raw) continue;
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // 容错：尝试去掉尾随逗号后再解析
      try { data = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); } catch { blocks.push({ error: true, size: raw.length }); continue; }
    }
    blocks.push({ error: false, size: raw.length, types: (() => { const t = new Set(); const before = new Set(types); walk(data); for (const x of types) if (!before.has(x)) t.add(x); return [...t]; })() });
    walk(data);
  }
  return { blocks, types: [...types] };
}

/**
 * 把抓取结果加工成完整的页面模型。所有规则只读这个对象。
 */
export function buildPageModel(fetched, { targetUrl } = {}) {
  const html = fetched.html || '';
  const finalUrl = fetched.finalUrl || targetUrl;
  const doc = parseHtml(html, { baseUrl: finalUrl });
  const metas = metaIndex(doc);
  const baseHref = doc.first('base')?.attrs.href;
  const baseUrl = baseHref ? resolveUrl(baseHref, finalUrl) || finalUrl : finalUrl;

  const title = doc.title();
  const titleNode = doc.first('title');
  const description = stripTagsDeep(metas.get('description') || '');
  const robotsMeta = stripTagsDeep(metas.get('robots') || '').toLowerCase();
  const viewportMeta = metas.get('viewport') || '';
  const htmlNode = doc.first('html');

  const headings = [];
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
    for (const n of doc.all(tag)) {
      headings.push({ level: Number(tag[1]), text: stripTagsDeep(decodeEntities(n.text)), order: n.order });
    }
  }
  headings.sort((a, b) => a.order - b.order);

  const canonicalNode = doc.all('link').find((n) => String(n.attrs.rel || '').toLowerCase().split(/\s+/).includes('canonical'));
  const canonical = canonicalNode ? resolveUrl(canonicalNode.attrs.href || '', baseUrl) : null;

  const iconLinks = doc.all('link').filter((n) => /\bicon\b/i.test(n.attrs.rel || ''));
  const favicons = iconLinks.map((n) => ({
    rel: n.attrs.rel, href: resolveUrl(n.attrs.href || '', baseUrl), sizes: n.attrs.sizes || '', type: n.attrs.type || '',
  })).filter((x) => x.href);

  const hreflangs = doc.all('link')
    .filter((n) => String(n.attrs.rel || '').toLowerCase() === 'alternate' && n.attrs.hreflang)
    .map((n) => ({ lang: n.attrs.hreflang.toLowerCase(), href: resolveUrl(n.attrs.href || '', baseUrl) }))
    .filter((x) => x.href);

  const images = doc.all('img').map((n) => ({
    src: resolveUrl(n.attrs.src || n.attrs['data-src'] || '', baseUrl),
    alt: n.attrs.alt,
    loading: (n.attrs.loading || '').toLowerCase(),
    width: n.attrs.width, height: n.attrs.height,
    srcset: Boolean(n.attrs.srcset || n.attrs['data-srcset']),
    decoding: n.attrs.decoding,
  }));

  const scripts = doc.all('script').map((n) => ({
    src: n.attrs.src ? resolveUrl(n.attrs.src, baseUrl) : null,
    async: 'async' in n.attrs,
    defer: 'defer' in n.attrs,
    type: (n.attrs.type || '').toLowerCase(),
    module: (n.attrs.type || '').toLowerCase() === 'module',
    text: n.attrs.src ? '' : n.text,
  }));

  const stylesheets = doc.all('link')
    .filter((n) => String(n.attrs.rel || '').toLowerCase() === 'stylesheet')
    .map((n) => ({ href: resolveUrl(n.attrs.href || '', baseUrl), media: n.attrs.media || '' }));

  const inlineStyleBlocks = doc.all('style');
  const links = doc.all('a').map((n) => {
    const href = n.attrs.href || '';
    const abs = resolveUrl(href, baseUrl);
    return {
      href: abs,
      raw: href,
      text: stripTagsDeep(n.text),
      rel: (n.attrs.rel || '').toLowerCase(),
      target: n.attrs.target || '',
      nofollow: /\bnofollow\b/.test(n.attrs.rel || ''),
      internal: abs ? isSameOrigin(abs, finalUrl) : href.startsWith('#') || href.startsWith('/'),
      hashOnly: href.startsWith('#'),
      protocol: abs ? new URL(abs).protocol : '',
    };
  }).filter((l) => l.href || l.hashOnly);

  const jsonldScripts = doc.all('script').filter((n) => (n.attrs.type || '').toLowerCase() === 'application/ld+json');
  const jsonld = parseJsonLd(jsonldScripts);
  const microdataTypes = new Set();
  for (const n of doc.walk((x) => 'itemtype' in x.attrs)) {
    for (const t of String(n.attrs.itemtype).split(/\s+/)) if (t) microdataTypes.add(t.split('/').pop());
  }
  const text = doc.visibleText();
  const wordCount = countWords(text);
  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const textBytes = Buffer.byteLength(text, 'utf8');

  const og = {};
  const twitter = {};
  for (const [k, v] of metas) {
    if (k.startsWith('og:')) og[k.slice(3)] = v;
    else if (k.startsWith('twitter:')) twitter[k.slice(8)] = v;
  }

  const forms = doc.all('form').map((n) => ({
    action: resolveUrl(n.attrs.action || '', baseUrl),
    method: (n.attrs.method || 'get').toLowerCase(),
    hasPassword: n.children.some((c) => c.tag === 'input' && (c.attrs.type || '').toLowerCase() === 'password')
      || doc.all('input').some((i) => (i.attrs.type || '').toLowerCase() === 'password'),
  }));

  const iframes = doc.all('iframe').map((n) => ({
    src: n.attrs.src ? resolveUrl(n.attrs.src, baseUrl) : null,
    title: n.attrs.title || '',
    loading: (n.attrs.loading || '').toLowerCase(),
  }));

  const resourceHints = {
    preconnect: doc.all('link').filter((n) => /preconnect/i.test(n.attrs.rel || '')).length,
    dnsPrefetch: doc.all('link').filter((n) => /dns-prefetch/i.test(n.attrs.rel || '')).length,
    preload: doc.all('link').filter((n) => /preload/i.test(n.attrs.rel || '')).map((n) => ({
      href: resolveUrl(n.attrs.href || '', baseUrl),
      as: n.attrs.as || '',
      crossorigin: 'crossorigin' in n.attrs,
    })),
  };

  const ariaCount = doc.walk((n) => Object.keys(n.attrs).some((k) => k.startsWith('aria-') || k === 'role') ? n : false);
  const nodesWithAria = [];
  for (const n of ariaCount) nodesWithAria.push(n);
  const hasSkipLink = links.some((l) => l.hashOnly && /^(#main|#content|#main-content|#skip|#skip-to-content)$/i.test(l.raw));

  const semantic = {
    main: doc.all('main').length,
    article: doc.all('article').length,
    section: doc.all('section').length,
    nav: doc.all('nav').length,
    aside: doc.all('aside').length,
    header: doc.all('header').length,
    footer: doc.all('footer').length,
    figure: doc.all('figure').length,
    time: doc.all('time').length,
  };

  const questionHeadings = headings.filter((h) => /[?？]\s*$/.test(h.text)
    || /^(how|what|why|when|where|which|who|can|does|is|are|do|should)\b/i.test(h.text)
    || /(是什么|怎么做|如何|为什么|哪些|多少|多久|能不能|是否|怎么)/.test(h.text));

  const paragraphs = doc.all('p').length;
  const lists = doc.all('ul').length + doc.all('ol').length;
  const tables = doc.all('table').length;
  const inlineStyles = doc.walk().reduce((acc, n) => acc + ('style' in n.attrs ? 1 : 0), 0);

  const dupeIds = (() => {
    const seen = new Map();
    const dupes = new Set();
    for (const n of doc.walk()) {
      const id = n.attrs.id;
      if (!id) continue;
      if (seen.has(id)) dupes.add(id);
      else seen.set(id, true);
    }
    return [...dupes].slice(0, 10);
  })();

  const anchorsNoText = links.filter((l) => !l.hashOnly && !l.text && !/[?&](lang|utm)/.test(l.raw));

  const imagesNoAlt = images.filter((i) => i.alt === undefined);
  const imagesEmptyAlt = images.filter((i) => i.alt === '');
  const imagesLazy = images.filter((i) => i.loading === 'lazy');
  const imagesNoDim = images.filter((i) => !i.width || !i.height);

  const header = (name) => {
    const v = fetched.headers?.[name.toLowerCase()];
    return Array.isArray(v) ? v.join(', ') : v || '';
  };

  const scriptBytes = scripts.reduce((a, s) => a + (s.src ? 0 : Buffer.byteLength(s.text, 'utf8')), 0);
  const cssBytes = inlineStyleBlocks.reduce((a, n) => a + Buffer.byteLength(n.text, 'utf8'), 0);
  // 阻塞解析的脚本：外链且没有 async/defer，或内联但内容不只是 JSON 数据。
  // JSON-LD（type=application/ld+json）不是可执行脚本，浏览器不会为它阻塞解析，
  // 之前把它算进阻塞列表，导致「加了结构化数据反而被扣性能分」的荒谬结果。
  const EXECUTABLE = /^(|text\/javascript|module|application\/javascript)$/i;
  const blockingScripts = scripts.filter((s) => {
    if (s.async || s.defer || s.module) return false;
    if (!EXECUTABLE.test(s.type)) return false;
    if (s.src) return /^https?:/.test(s.src);
    return Boolean(s.text.trim());
  });
  const fontFaces = inlineStyleBlocks.map((n) => n.text).join('\n');
  const fontDisplayMissing = /@font-face/.test(fontFaces) && !/font-display\s*:\s*(swap|optional|fallback)/i.test(fontFaces);

  const metaKeywords = stripTagsDeep(metas.get('keywords') || '');

  return {
    url: targetUrl,
    finalUrl,
    baseUrl,
    status: fetched.status,
    headers: fetched.headers,
    contentType: fetched.contentType,
    charset: fetched.charset,
    html,
    htmlBytes,
    truncated: fetched.truncated,
    elapsedMs: fetched.elapsedMs,
    redirects: fetched.redirects || [],
    negotiated: {
      httpVersion: fetched.httpVersion || '',
      contentEncoding: header('content-encoding').toLowerCase(),
      acceptRanges: Boolean(header('accept-ranges')),
      server: header('server'),
      poweredBy: header('x-powered-by'),
      cacheControl: header('cache-control'),
      etag: Boolean(header('etag')),
      lastModified: Boolean(header('last-modified')),
    },
    doc,
    doctype: doc.doctype,
    lang: (htmlNode?.attrs.lang || '').trim(),
    dir: (htmlNode?.attrs.dir || '').trim(),
    title,
    titleLength: [...title].length,
    titleHasPipe: /[|\-–—_»/]/.test(title),
    description,
    descriptionLength: [...description].length,
    metaKeywords,
    robotsMeta,
    viewportMeta,
    viewportOk: /width\s*=\s*device-width/i.test(viewportMeta),
    canonical,
    canonicalIsSelf: canonical ? normalizeForCompare(canonical) === normalizeForCompare(finalUrl) : null,
    favicons,
    hreflangs,
    headings,
    h1s: headings.filter((h) => h.level === 1),
    headingCounts: [1, 2, 3, 4, 5, 6].map((lv) => headings.filter((h) => h.level === lv).length),
    images,
    imagesNoAlt,
    imagesEmptyAlt,
    imagesLazy,
    imagesNoDim,
    links,
    internalLinks: links.filter((l) => l.internal && !l.hashOnly),
    externalLinks: links.filter((l) => !l.internal && /^https?:/.test(l.protocol)),
    nofollowLinks: links.filter((l) => l.nofollow),
    anchorsNoText,
    brokenHashAnchors: [],
    scripts,
    blockingScripts,
    stylesheets,
    inlineStyleCount: inlineStyles,
    inlineStyleBytes: cssBytes,
    inlineScriptBytes: scriptBytes,
    fontDisplayMissing,
    text,
    textLength: text.length,
    textBytes,
    wordCount,
    sentenceCount: countSentences(text),
    // 两边都按字节算。之前用「字符数 / 字节数」，中文一个字占 3 字节，
    // 中文站点的比值会被硬压到三分之一，永远判成内容稀薄。
    textHtmlRatio: htmlBytes ? textBytes / htmlBytes : 0,
    paragraphCount: paragraphs,
    listCount: lists,
    tableCount: tables,
    keywords: extractKeywords(`${title} ${title} ${description} ${text}`, 12),
    metaIndex: metas,
    og,
    twitter,
    jsonld,
    structuredTypes: [...new Set([...jsonld.types, ...microdataTypes])],
    hasMicrodata: microdataTypes.size > 0,
    semantic,
    forms,
    iframes,
    resourceHints,
    ariaNodeCount: nodesWithAria.length,
    hasSkipLink,
    dupeIds,
    questionHeadings,
    securityHeaders: {
      hsts: header('strict-transport-security'),
      csp: header('content-security-policy'),
      xContentTypeOptions: header('x-content-type-options'),
      xFrameOptions: header('x-frame-options'),
      referrerPolicy: header('referrer-policy'),
      permissionsPolicy: header('permissions-policy'),
      coop: header('cross-origin-opener-policy'),
    },
    registrableDomain: registrableDomain(new URL(finalUrl).hostname),
    stats: {
      nodes: doc.nodes,
      truncated: doc.truncated,
      // 资源域名（脚本/样式/图片/iframe）才和 preconnect 有关；
      // 普通外链的域名不需要预连接，之前两者混在一起，规则就会误报。
      resourceHosts: [...new Set(
        [...scripts.map((x) => x.src), ...stylesheets.map((x) => x.href), ...images.map((x) => x.src), ...iframes.map((x) => x.src)]
          .filter((u) => u && /^https?:/i.test(u))
          .map((u) => { try { return new URL(u).hostname; } catch { return null; } })
          .filter((h) => h && h !== safeHostname(finalUrl))
      )].slice(0, 20),
      externalHosts: [...new Set(links.filter((l) => l.href && !l.internal).map((l) => { try { return new URL(l.href).hostname; } catch { return null; } }).filter(Boolean))].slice(0, 20),
    },
  };
}

function safeHostname(u) {
  try { return new URL(u).hostname; } catch { return ''; }
}

function normalizeForCompare(u) {
  try {
    const url = new URL(u);
    let p = url.pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host.toLowerCase()}${p}${url.search}`;
  } catch {
    return String(u);
  }
}

export { CJK, normalizeForCompare };
