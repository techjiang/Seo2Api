import { pass, warn, fail, info, cut, snippet } from './helpers.js';

/**
 * AI 可读性（GEO / AEO）——本系统的创新维度。
 *
 * 背景：搜索正在从"给链接"变成"给答案"。AI 搜索（Perplexity、ChatGPT Search、
 * Google AI Overview、微信 AI 搜索）会先从页面抽取"可引用的事实块"再组织答案。
 * 一个页面能不能被引用，跟传统 SEO 指标并不完全重合：
 *   - 有没有机器可读的站点索引（llms.txt）
 *   - 段落是否"自包含"（脱离上下文也能读懂，才方便摘录）
 *   - 有没有问答式结构（FAQ 是 AI 最爱摘的形式）
 *   - 有没有明确的实体身份（Organization / Person，帮 AI 消歧）
 *   - 数字、时间、单位是否明确（"约三成"不如"32%"可引用）
 */
export const aiReadinessRules = [
  {
    id: 'llms-txt',
    dimension: 'ai',
    severity: 'minor',
    weight: 2,
    title: '提供 llms.txt 站点索引',
    description: 'llms.txt 是给大模型看的站点地图：用 Markdown 列出站点结构、关键页面与简短说明，让 AI 无需爬全站就能理解你的内容。这是新兴但增长极快的标准。',
    check: ({ aux, auxFetched }) => {
      if (auxFetched === false) return info('快速模式未抓取 llms.txt，跳过检测。');
      if (aux?.llmsTxt) {
        const t = aux.llmsTxt;
        if (!t.title) return warn('llms.txt 存在但缺少 # 一级标题。', { fix: snippet('# 站点名称\n> 一句话说明站点提供什么价值\n\n## 核心页面\n- [产品](https://example.com/product): 说明') });
        if (!t.linkCount) return warn('llms.txt 已存在但没有任何链接条目。');
        return pass(`llms.txt 已配置（${t.linkCount} 个条目${t.sections.length ? `，${t.sections.length} 个分组` : ''}）。`);
      }
      return warn('未提供 /llms.txt。AI 搜索时代，这相当于"给模型的站点导航"。', {
        fix: snippet('# 站点名称\n> 用一句话说明这个网站提供什么，给谁用。\n\n## 核心页面\n- [产品介绍](https://example.com/product): 功能与定价\n- [文档](https://example.com/docs): 完整使用说明\n\n## 可选\n- [博客](https://example.com/blog)'),
      });
    },
  },
  {
    id: 'faq-structure',
    dimension: 'ai',
    severity: 'major',
    weight: 2.5,
    title: '包含问答式内容结构',
    description: 'AI 搜索最常引用的形式就是"问题 + 直接答案"。用疑问句做标题、紧跟一段 40–60 字的直接回答，被选为答案的概率会明显提高。',
    check: ({ page }) => {
      const q = page.questionHeadings.length;
      const hasFaqSchema = page.structuredTypes.some((t) => /faqpage|qapage|question|howto/i.test(t));
      if (q === 0 && !hasFaqSchema) {
        return fail('页面没有问答式标题，也没有 FAQ 结构化数据，AI 很难直接摘取答案。', {
          fix: snippet('<h2>Seo2Api 支持哪些检测项？</h2>\n<p>覆盖内容、技术、性能、可访问性等 8 个维度共 60+ 项检查，返回结构化 JSON 与修复建议。</p>'),
        });
      }
      if (hasFaqSchema) return pass(`配置了 FAQ 结构化数据${q ? `，另有 ${q} 个问答式标题` : ''}。`);
      if (q === 1) return warn('只有 1 个问答式标题，建议补充 3 个以上的常见问题。');
      return pass(`有 ${q} 个问答式标题，利于 AI 摘取答案。`);
    },
  },
  {
    id: 'self-contained-paragraphs',
    dimension: 'ai',
    severity: 'minor',
    weight: 1.5,
    title: '段落自包含（可被独立引用）',
    description: 'AI 摘录的是单个段落。如果段落里充满"它""这个""如上所述"，脱离上下文就失去意义，也就不会被引用。',
    check: ({ page }) => {
      if (page.paragraphCount < 3) return info('段落过少，跳过自包含检测。');
      const paras = [...page.doc.all('p')].map((p) => p.text.trim()).filter((t) => t.length > 40);
      if (!paras.length) return info('无足够长的段落可分析。');
      const vague = paras.filter((t) => /^(它|他|她|这|那|该|此|其|上述|如上|前面|it|this|that|they|these|those)\b/i.test(t)
        || /(如前所述|综上所述如上|见上文)/.test(t));
      const rate = vague.length / paras.length;
      if (rate > 0.4) return warn(`${vague.length}/${paras.length} 个段落以指代词开头，脱离上下文难以理解，不利于被 AI 引用。`);
      return pass(`${paras.length} 个长段落中仅 ${vague.length} 个以指代词开头，自包含性良好。`);
    },
  },
  {
    id: 'entity-identity',
    dimension: 'ai',
    severity: 'minor',
    weight: 1.5,
    title: '明确的实体身份（Organization / Person）',
    description: 'AI 需要知道"你是谁"才能正确归属信息。用 Organization / Person 结构化数据声明名称、Logo、社交账号，可显著提升被正确引用的概率。',
    check: ({ page }) => {
      const types = page.structuredTypes.join(',').toLowerCase();
      if (/organization|person|localbusiness|corporation/.test(types)) return pass('已声明组织/个人实体。');
      if (!page.structuredTypes.length) return info('无结构化数据，跳过实体检测。');
      return warn('有结构化数据但缺少 Organization / Person 实体声明。', {
        fix: snippet(`<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "品牌名",
  "url": "${page.baseUrl}",
  "logo": "${page.baseUrl}/logo.png",
  "sameAs": ["https://x.com/yourbrand", "https://github.com/yourbrand"]
}
</script>`),
      });
    },
  },
  {
    id: 'fact-density',
    dimension: 'ai',
    severity: 'minor',
    weight: 1,
    title: '内容包含可引用的事实（数字/时间/单位）',
    description: '"效果很好"不可引用，"响应时间从 1200ms 降到 180ms"可以。具体数字、时间、比例是 AI 摘录的首选素材。',
    check: ({ page }) => {
      if (page.wordCount < 150) return info('内容过短，跳过事实密度检测。');
      const numbers = (page.text.match(/\d+(\.\d+)?%?/g) || []).length;
      const dates = (page.text.match(/\d{4}\s*[-年/]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/g) || []).length;
      const density = (numbers + dates * 2) / Math.max(1, page.wordCount / 100);
      if (density < 1) return warn(`每 100 字仅约 ${density.toFixed(1)} 个具体数据点，内容偏主观，不易被 AI 引用。`, {
        fix: snippet('<p>首屏加载时间从 1.2 秒降到 0.4 秒，跳出率下降 23%（2024 年 6 月实测）。</p>'),
      });
      return pass(`每 100 字约 ${density.toFixed(1)} 个数据点，事实密度充足。`);
    },
  },
  {
    id: 'answer-first',
    dimension: 'ai',
    severity: 'minor',
    weight: 1.2,
    title: '开头直接给出结论',
    description: 'AI 与人一样偏好"先结论后论证"。首段就点明核心答案，比绕三段铺垫更容易被摘录为答案。',
    check: ({ page }) => {
      if (!page.text || page.wordCount < 100) return info('内容过短，跳过开头结构检测。');
      const firstBlock = (page.text.split('\n').find((l) => l.trim().length > 20) || page.text).slice(0, 300);
      const filler = /^(欢迎|大家好|众所周知|随着.{0,10}的发展|在当今|近年来|随着互联网)/.test(firstBlock)
        || /^(welcome|hello|in today's|nowadays|as we all know)/i.test(firstBlock);
      if (filler) return warn('正文开头是套话（"随着…发展""众所周知"），建议首句直接给出核心结论。', {
        fix: snippet('<p>Seo2Api 是一个零依赖的 SEO 检测 API：一次请求返回 60+ 项检查、8 维评分和可直接复制的修复代码。</p>'),
      });
      return pass('开头直接进入主题，无客套铺垫。');
    },
  },
  {
    id: 'heading-as-question-density',
    dimension: 'ai',
    severity: 'minor',
    weight: 0.8,
    title: '小标题信息量足够',
    description: 'AI 与用户都靠小标题扫描内容。"功能一""详情"这类标题几乎不传递信息；描述性标题能独立成句才最好。',
    check: ({ page }) => {
      const subs = page.headings.filter((h) => h.level >= 2);
      if (subs.length < 3) return info('小标题过少，跳过检测。');
      // 阈值按语言区分：中文 4 字已经能讲清事（「快速开始」），
      // 套用英文的 6 字符门槛会把正常中文标题全判成信息量不足。
      const weak = subs.filter((h) => {
        const text = h.text.trim();
        const cjkOnly = /^[\u3400-\u4dbf\u4e00-\u9fff\s]+$/.test(text);
        const tooShort = cjkOnly ? [...text].length < 3 : text.split(/\s+/).filter(Boolean).length < 2 && text.length < 6;
        return tooShort || /^(功能[\u4e00-\u9fff]?|详情|更多|其他|简介|说明|overview|details|more|other)[\d\s]*$/i.test(text);
      });
      if (weak.length / subs.length > 0.3) {
        return warn(`${weak.length}/${subs.length} 个小标题信息量不足（如「${cut(weak[0].text, 20)}」），建议写清具体内容。`);
      }
      return pass(`${subs.length} 个小标题信息量充足。`);
    },
  },
  {
    id: 'machine-readable-metadata',
    dimension: 'ai',
    severity: 'minor',
    weight: 1,
    title: '元数据完整利于机器理解',
    description: '标题 + 描述 + 规范的 H1 + 结构化类型，是 AI 判断"这个页面讲什么"的最小信息集。缺一项都会降低置信度。',
    check: ({ page }) => {
      const checks = {
        title: Boolean(page.title),
        description: Boolean(page.description),
        h1: page.h1s.length === 1,
        schema: page.structuredTypes.length > 0,
        lang: Boolean(page.lang),
      };
      const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length === 0) return pass('Title / Description / H1 / 结构化数据 / lang 齐备。');
      if (missing.length >= 3) return fail(`机器可读信息缺失 ${missing.length} 项：${missing.join('、')}。`);
      return warn(`机器可读信息缺失：${missing.join('、')}。`);
    },
  },
  {
    id: 'citable-summary',
    dimension: 'ai',
    severity: 'minor',
    weight: 0.8,
    title: '存在可摘录的摘要段',
    description: '页面前部有一小段 40–80 字的概括性文字（TL;DR / 摘要），是最容易被 AI 直接引用的"答案源"。',
    check: ({ page }) => {
      if (page.wordCount < 200) return info('内容较短，跳过摘要检测。');
      const firstParas = [...page.doc.all('p')].map((p) => p.text.trim()).filter((t) => t.length > 20).slice(0, 4);
      const hasAbstract = firstParas.some((t) => [...t].length >= 30 && [...t].length <= 200);
      const hasMetaDesc = page.description.length >= 70;
      if (hasAbstract || hasMetaDesc) return pass('页面存在可摘录的摘要段。');
      return warn('开头段落过短，缺少 40–80 字的概括性摘要。', {
        fix: snippet('<p class="lede">一句话说清这个页面解决什么问题、给谁用、有什么证据。</p>'),
      });
    },
  },
];
