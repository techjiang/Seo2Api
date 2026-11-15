import { pass, warn, fail, info, atLeast, cut, snippet } from './helpers.js';

const isNoindex = (page) => /\bnoindex\b/.test(page.robotsMeta);

export const technicalRules = [
  {
    id: 'indexable',
    dimension: 'technical',
    severity: 'critical',
    weight: 4,
    title: '页面允许被索引',
    description: 'meta robots 或响应头里的 noindex 会让页面彻底从搜索结果中消失。上线前务必确认。',
    check: ({ page }) => {
      const xRobots = String(page.headers['x-robots-tag'] || '').toLowerCase();
      if (/\bnoindex\b/.test(xRobots)) {
        return fail('HTTP 响应头 X-Robots-Tag 包含 noindex，页面不会被索引。', {
          fix: snippet('X-Robots-Tag: index, follow'),
        });
      }
      if (/\bnone\b/.test(page.robotsMeta)) {
        return fail('meta robots 为 none，等价于 noindex, nofollow。');
      }
      if (isNoindex(page)) {
        return fail(`meta robots 包含 noindex（当前：${cut(page.robotsMeta, 60)}）。`, {
          fix: snippet('<meta name="robots" content="index, follow">'),
        });
      }
      return pass(page.robotsMeta ? `robots 指令：${cut(page.robotsMeta, 60)}` : '未设置限制性 robots 指令，默认可索引。');
    },
  },
  {
    id: 'http-status',
    dimension: 'technical',
    severity: 'critical',
    weight: 3,
    title: 'HTTP 状态码为 200',
    description: '4xx/5xx 页面无法被索引。软 404（返回 200 但内容是"页面不存在"）同样有害。',
    check: ({ page }) => {
      if (page.status === 200) return pass('返回 200 OK。');
      if (page.status >= 300 && page.status < 400) return warn(`返回 ${page.status} 重定向状态码，最终落地页应直接返回 200。`);
      if (page.status >= 400 && page.status < 500) return fail(`返回 ${page.status}，页面无法被索引。`);
      if (page.status >= 500) return fail(`返回 ${page.status} 服务器错误，会快速消耗抓取配额。`);
      return warn(`非标准状态码 ${page.status}。`);
    },
  },
  {
    id: 'doctype',
    dimension: 'technical',
    severity: 'minor',
    weight: 0.6,
    title: '声明了 HTML5 Doctype',
    description: '缺少 <!DOCTYPE html> 会触发浏览器的怪异模式（quirks mode），导致样式与盒模型渲染异常。',
    check: ({ page }) => {
      if (!page.doctype) return fail('页面未声明 doctype。', { fix: snippet('<!DOCTYPE html>\n<html lang="zh-CN">') });
      if (page.doctype !== 'html') return warn(`doctype 为「${cut(page.doctype, 40)}」，建议使用 HTML5 的 <!DOCTYPE html>。`);
      return pass('HTML5 doctype 已声明。');
    },
  },
  {
    id: 'canonical',
    dimension: 'technical',
    severity: 'major',
    weight: 2.5,
    title: '设置了 Canonical 规范链接',
    description: 'canonical 告诉搜索引擎哪个 URL 是权威版本，避免带参链接、http/https、www/非 www 造成重复内容分散权重。',
    check: ({ page }) => {
      if (!page.canonical) {
        return fail('缺少 rel="canonical"，重复内容风险高。', {
          fix: snippet(`<link rel="canonical" href="${page.finalUrl}">`),
        });
      }
      if (page.canonicalIsSelf === false) {
        return warn(`canonical 指向 ${cut(page.canonical, 80)}，与当前 URL 不一致，请确认是否为有意设置的聚合页。`, {
          fix: snippet(`<link rel="canonical" href="${page.finalUrl}">`),
        });
      }
      if (page.redirects.length && page.canonicalIsSelf) {
        return warn(`canonical 指向当前 URL，但页面经历了 ${page.redirects.length} 次重定向，建议 canonical 直接指向最终 URL。`, {
          fix: snippet(`<link rel="canonical" href="${page.finalUrl}">`),
        });
      }
      return pass(`canonical 指向自身：${cut(page.canonical, 80)}`);
    },
  },
  {
    id: 'structured-data',
    dimension: 'technical',
    severity: 'major',
    weight: 2,
    title: '包含结构化数据（JSON-LD / Microdata）',
    description: 'Schema.org 结构化数据可让搜索结果出现星级、面包屑、FAQ 折叠等富媒体结果，显著提升点击率。',
    check: ({ page }) => {
      const types = page.structuredTypes;
      if (page.jsonld.blocks.length === 0 && !page.hasMicrodata) {
        return fail('未检测到任何结构化数据，错失富媒体搜索结果。', {
          fix: snippet(`<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "${page.title || '页面标题'}",
  "url": "${page.finalUrl}"
}
</script>`),
        });
      }
      const hasError = page.jsonld.blocks.some((b) => b.error);
      if (hasError) return warn('存在无法解析的 JSON-LD 块，语法可能有误。', { fix: snippet('<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage"}</script>') });
      if (types.length) return pass(`已使用结构化类型：${types.slice(0, 6).join(', ')}`);
      return warn('有 JSON-LD 但未识别到 @type，建议补充明确的 schema 类型。');
    },
  },
  {
    id: 'schema-recommended',
    dimension: 'technical',
    severity: 'minor',
    weight: 1,
    title: '结构化数据覆盖核心类型',
    description: '检查是否覆盖 WebSite、Organization、BreadcrumbList 等基础类型，以及内容型页面常用的 Article / Product / FAQPage。',
    check: ({ page }) => {
      if (!page.structuredTypes.length) return info('无结构化数据，跳过类型覆盖评估。');
      const found = page.structuredTypes.map((t) => t.toLowerCase());
      const foundAny = (list) => list.some((x) => found.includes(x.toLowerCase()));
      const core = foundAny(['website', 'organization', 'person', 'webpage']);
      const nav = foundAny(['breadcrumblist', 'itemlist']);
      const content = foundAny(['article', 'blogposting', 'product', 'faqpage', 'howto', 'recipe', 'event', 'course', 'videoobject', 'service']);
      const score = [core, nav, content].filter(Boolean).length;
      if (score === 3) return pass('已覆盖站点/导航/内容三类结构化数据。');
      const missing = [];
      if (!core) missing.push('WebSite 或 Organization（站点身份）');
      if (!nav) missing.push('BreadcrumbList（面包屑导航）');
      if (!content) missing.push('Article / Product / FAQPage（内容类型）');
      if (score === 0) return fail(`缺少基础结构化类型：${missing.join('、')}。`);
      return warn(`结构化数据可补强：${missing.join('、')}。`);
    },
  },
  {
    id: 'lang-attribute',
    dimension: 'technical',
    severity: 'major',
    weight: 1.5,
    title: 'HTML 标签声明 lang',
    description: 'lang 属性帮助搜索引擎判定页面语言、帮助浏览器选择字体和翻译提示，也是 WCAG 的硬性要求。',
    check: ({ page }) => {
      if (!page.lang) return fail('<html> 缺少 lang 属性。', { fix: snippet('<html lang="zh-CN">') });
      if (!/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(page.lang)) return warn(`lang 值「${cut(page.lang, 20)}」格式不规范，应为 zh-CN / en 这类 BCP-47 标签。`);
      return pass(`lang="${page.lang}"`);
    },
  },
  {
    id: 'viewport',
    dimension: 'technical',
    severity: 'critical',
    weight: 2.5,
    title: '移动端 viewport 配置正确',
    description: '移动优先索引时代，缺少 viewport 会让页面在手机上按桌面宽度渲染，移动端体验和排名都会崩。',
    check: ({ page }) => {
      if (!page.viewportMeta) {
        return fail('缺少 viewport meta 标签，移动端显示会严重错乱。', {
          fix: snippet('<meta name="viewport" content="width=device-width, initial-scale=1">'),
        });
      }
      if (!page.viewportOk) return warn(`viewport 内容为「${cut(page.viewportMeta, 80)}」，建议包含 width=device-width。`, { fix: snippet('<meta name="viewport" content="width=device-width, initial-scale=1">') });
      if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/i.test(page.viewportMeta)) {
        return warn('禁止了用户缩放（user-scalable=no），会损害可访问性。', { fix: snippet('<meta name="viewport" content="width=device-width, initial-scale=1">') });
      }
      return pass(`viewport：${cut(page.viewportMeta, 80)}`);
    },
  },
  {
    id: 'charset',
    dimension: 'technical',
    severity: 'major',
    weight: 1.2,
    title: '声明字符编码',
    description: '缺少 charset 或声明过晚会造成中文乱码。UTF-8 应在 <head> 最前面声明。',
    check: ({ page, response }) => {
      const declared = page.metaIndex.get('charset') || /charset=([\w-]+)/i.exec(page.metaIndex.get('content-type') || '')?.[1];
      const headerCharset = /charset=([\w-]+)/i.exec(response?.contentType || '')?.[1];
      if (!declared && !headerCharset) return fail('未声明字符编码。', { fix: snippet('<meta charset="utf-8">') });
      const value = String(declared || headerCharset).toLowerCase();
      if (value !== 'utf-8' && value !== 'utf8') return warn(`字符编码为 ${value}，建议统一使用 UTF-8。`);
      return pass('字符编码为 UTF-8。');
    },
  },
  {
    id: 'duplicate-id',
    dimension: 'technical',
    severity: 'minor',
    weight: 0.5,
    title: '页面内 ID 唯一',
    description: '重复的 id 会让锚点跳转失效，也会让 JS 和 CSS 选择器行为不可预期。',
    check: ({ page }) => {
      if (!page.dupeIds.length) return pass('未发现重复 id。');
      return warn(`发现重复 id：${page.dupeIds.slice(0, 5).join('、')}。`);
    },
  },
  {
    id: 'no-soft-404',
    dimension: 'technical',
    severity: 'minor',
    weight: 1,
    title: '未出现软 404 特征',
    description: '页面标题或正文出现"页面不存在""404"但状态码仍是 200，会让搜索引擎收录大量垃圾页。',
    check: ({ page }) => {
      if (page.status !== 200) return info('非 200 页面，跳过软 404 检测。');
      const t = `${page.title} ${page.h1s.map((h) => h.text).join(' ')}`.toLowerCase();
      const suspicious = /(页面不存在|找不到页面|404|not found|page not found|页面未找到)/i.test(t);
      if (suspicious && page.wordCount < 150) {
        return warn('页面标题像错误页但返回 200，可能是软 404。');
      }
      return pass('未发现软 404 特征。');
    },
  },
  {
    id: 'url-quality',
    dimension: 'technical',
    severity: 'minor',
    weight: 1,
    title: 'URL 结构清晰友好',
    description: '短、含关键词、可读的 URL 更利于用户分享和点击；避免深层嵌套、大写、下划线和冗余参数。',
    check: ({ page }) => {
      let url;
      try { url = new URL(page.finalUrl); } catch { return info('URL 无法解析。'); }
      const issues = [];
      if (url.pathname.length > 120) issues.push('路径过长');
      if (url.pathname.split('/').filter(Boolean).length > 5) issues.push('层级过深');
      if (/[A-Z]/.test(url.pathname)) issues.push('含大写字母');
      if (url.pathname.includes('_')) issues.push('使用下划线（建议 -）');
      if (/\/(index|default)\.(php|html?|aspx?)$/i.test(url.pathname)) issues.push('包含默认文件名');
      const params = [...url.searchParams.keys()];
      if (params.length > 3) issues.push(`参数过多（${params.length} 个）`);
      if (/[?&](sid|sessionid|phpsessid)=/i.test(url.search)) issues.push('包含会话 ID 参数');
      if (url.pathname.length > 1 && url.pathname.endsWith('/') === false && /\.[a-z]{2,4}$/i.test(url.pathname) === false) {
        // 无扩展名且无尾斜杠，属于风格差异，不扣分
      }
      if (issues.length === 0) return pass(`URL 结构清晰（${url.pathname}）。`);
      return warn(`URL 可优化：${issues.join('；')}。`);
    },
  },
  {
    id: 'no-index-pagination-trap',
    dimension: 'technical',
    severity: 'minor',
    weight: 0.5,
    title: '重定向链健康',
    description: '多跳重定向会拖慢加载并损耗爬虫配额，理想情况 0 跳，最多 1 跳。',
    check: ({ page }) => {
      const n = page.redirects.length;
      if (n === 0) return pass('无重定向，直接返回内容。');
      if (n === 1) return info(`经过 1 次重定向到 ${cut(page.redirects[0].to, 60)}。`);
      if (n <= 2) return warn(`经过 ${n} 次重定向，建议直接链接到最终 URL。`);
      return fail(`经过 ${n} 次重定向，链路过长。`, { fix: snippet(`将内部链接直接指向：${page.finalUrl}`) });
    },
  },
];
