import { pass, warn, fail, info, atLeast, atMost, levelToResult, cut, snippet, attr } from './helpers.js';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

export const contentRules = [
  {
    id: 'title-exists',
    dimension: 'content',
    severity: 'critical',
    weight: 3,
    title: '页面包含 Title 标签',
    description: '每个页面都必须有唯一的 <title>，它是搜索结果里蓝色的第一行，也是搜索引擎判断页面主题最直接的依据。',
    check: ({ page }) => {
      if (!page.title) {
        return fail('<title> 缺失或为空，搜索结果将自动截取正文片段，点击率会明显下降。', {
          fix: snippet('<head>\n  <title>主关键词 - 品牌名</title>\n</head>'),
        });
      }
      return pass(`Title 存在：「${cut(page.title, 70)}」`);
    },
  },
  {
    id: 'title-length',
    dimension: 'content',
    severity: 'major',
    weight: 2,
    title: 'Title 长度适中（20–60 字符）',
    description: '太短浪费排名机会，太长会被截断显示成「…」。中日韩字符按 1 计，建议 20–32 个汉字或 50–60 个英文字符。',
    check: ({ page }) => {
      if (!page.title) return fail('无 Title 可检测。');
      const len = page.titleLength;
      if (len < 10) {
        return fail(`Title 仅 ${len} 个字符，信息量不足。`, {
          fix: snippet('<title>核心关键词 + 次要关键词 - 品牌</title>'),
        });
      }
      if (len < 20) return warn(`Title ${len} 个字符，偏短，可再补充长尾词。`);
      if (len > 70) return fail(`Title ${len} 个字符，搜索结果会被严重截断（建议 ≤ 60）。`);
      if (len > 60) return warn(`Title ${len} 个字符，略长，移动端可能被截断。`);
      return pass(`Title ${len} 个字符，长度合适。`);
    },
  },
  {
    id: 'title-quality',
    dimension: 'content',
    severity: 'minor',
    weight: 1,
    title: 'Title 结构清晰（含品牌或分隔符）',
    description: '好的 Title 通常是「关键词 - 品牌」结构。避免关键词堆砌、全大写、以及"首页""欢迎光临"这类无信息量词汇。',
    check: ({ page }) => {
      if (!page.title) return fail('无 Title 可检测。');
      const problems = [];
      if (page.title === page.title.toUpperCase() && /[A-Z]{8,}/.test(page.title)) problems.push('全部大写');
      if (/(欢迎光临|untitled|无标题|new page|document|home page|首页$)/i.test(page.title)) problems.push('无信息量词汇');
      const words = page.title.toLowerCase().split(/[\s,|\-–—_]+/).filter((w) => w.length > 1);
      const dupes = words.filter((w, i) => words.indexOf(w) !== i);
      if (dupes.length) problems.push(`关键词重复（${[...new Set(dupes)].slice(0, 3).join('、')}）`);
      if (/[!！]{2,}|[?？]{2,}/.test(page.title)) problems.push('夸张标点');
      if (problems.length) {
        return warn(`Title 存在优化空间：${problems.join('；')}。`, {
          fix: snippet('<title>核心关键词 - 品牌名</title>'),
        });
      }
      return page.titleHasPipe
        ? pass('Title 含分隔符，结构清晰。')
        : info('Title 未使用分隔符，若为单句描述可忽略。');
    },
  },
  {
    id: 'description-exists',
    dimension: 'content',
    severity: 'major',
    weight: 2.5,
    title: '包含 Meta Description',
    description: '描述不直接参与排名，但它决定搜索结果里的摘要文案，直接影响点击率。缺失时搜索引擎会随机截取正文。',
    check: ({ page }) => {
      if (!page.description) {
        return fail('缺少 meta description，搜索结果摘要不可控。', {
          fix: snippet('<meta name="description" content="用一句话说清页面提供什么价值，含核心关键词。">'),
        });
      }
      return pass(`Description 存在（${page.descriptionLength} 字符）。`);
    },
  },
  {
    id: 'description-length',
    dimension: 'content',
    severity: 'minor',
    weight: 1.5,
    title: 'Description 长度合适（70–160 字符）',
    description: '桌面端约 155–160 字符、移动端约 120 字符会被截断，过短则浪费展示空间。',
    check: ({ page }) => {
      if (!page.description) return fail('无 Description 可检测。');
      const len = page.descriptionLength;
      if (len < 30) return fail(`Description 仅 ${len} 字符，过短。`, { fix: snippet('<meta name="description" content="补充到 70–160 字符。">') });
      if (len < 70) return warn(`Description ${len} 字符，偏短，建议补充到 70–160。`);
      if (len > 200) return fail(`Description ${len} 字符，过长会被截断。`);
      if (len > 160) return warn(`Description ${len} 字符，桌面端可能被截断（建议 ≤ 160）。`);
      return pass(`Description ${len} 字符，长度合适。`);
    },
  },
  {
    id: 'h1-single',
    dimension: 'content',
    severity: 'major',
    weight: 2.5,
    title: '有且仅有一个 H1',
    description: 'H1 是页面主题的声明，多个 H1 会稀释主题信号，缺失则让爬虫只能靠 Title 猜测。',
    check: ({ page }) => {
      const n = page.h1s.length;
      if (n === 0) {
        return fail('页面没有 H1 标题。', { fix: snippet('<h1>页面核心主题</h1>') });
      }
      if (n > 1) {
        return fail(`页面有 ${n} 个 H1：${page.h1s.slice(0, 3).map((h) => `「${cut(h.text, 26)}」`).join('、')}。`, {
          fix: snippet('保留一个 <h1>，其余改为 <h2>。'),
        });
      }
      const h1 = page.h1s[0];
      if (!h1.text) return warn('H1 内容为空。');
      if ([...h1.text].length > 120) return warn(`H1 过长（${[...h1.text].length} 字符）。`);
      return pass(`H1：「${cut(h1.text, 60)}」`);
    },
  },
  {
    id: 'heading-hierarchy',
    dimension: 'content',
    severity: 'minor',
    weight: 1.5,
    title: '标题层级不跳级',
    description: 'H1 → H2 → H3 依次递进，跳过层级会让大纲结构混乱，影响爬虫理解内容结构，也影响读屏软件导航。',
    check: ({ page }) => {
      if (!page.headings.length) return fail('页面没有任何标题标签。');
      const jumps = [];
      let prev = 0;
      for (const h of page.headings) {
        if (h.level === 1) { prev = 1; continue; }
        if (prev === 0) { prev = h.level; continue; }
        if (h.level > prev + 1) jumps.push(`H${prev} → H${h.level}「${cut(h.text, 20)}」`);
        prev = h.level;
      }
      if (jumps.length) {
        return warn(`存在 ${jumps.length} 处层级跳跃：${jumps.slice(0, 3).join('；')}。`, {
          fix: snippet('<h2>二级标题</h2>\n  <h3>三级标题</h3>'),
        });
      }
      return pass(`标题共 ${page.headings.length} 个，层级递进正常。`);
    },
  },
  {
    id: 'content-length',
    dimension: 'content',
    severity: 'major',
    weight: 2,
    title: '正文内容充足',
    description: '内容过少的页面很难覆盖长尾查询。中文按字计、英文按词计，建议至少 300 字以上的有效正文。',
    check: ({ page }) => {
      const w = page.wordCount;
      if (w === 0) return fail('页面没有可索引的正文内容（可能是纯 JS 渲染或空页面）。');
      const level = atLeast(w, 600, 300);
      if (level === 'pass') return pass(`正文约 ${w} 字/词，内容充足。`);
      if (level === 'warn') return warn(`正文约 ${w} 字/词，偏薄，建议扩充到 600 以上。`);
      return fail(`正文仅约 ${w} 字/词，内容过少，难以获得排名。`, {
        fix: snippet('<main>\n  <h1>主题</h1>\n  <p>围绕主题展开的详细说明……</p>\n</main>'),
      });
    },
  },
  {
    id: 'text-html-ratio',
    dimension: 'content',
    severity: 'minor',
    weight: 1,
    title: '文本 / HTML 比例合理',
    description: '正文文字占 HTML 的比例过低（< 10%）通常意味着页面靠大量标签、脚本或内联样式堆砌，内容稀薄。',
    check: ({ page }) => {
      const ratio = page.textHtmlRatio;
      if (page.htmlBytes < 200) return warn('页面体积异常小，可能内容未渲染。');
      const pct = (ratio * 100).toFixed(1);
      const level = atLeast(ratio, 0.15, 0.08);
      const msg = {
        pass: `文本占比 ${pct}%，结构健康。`,
        warn: `文本占比 ${pct}%，偏低，建议精简冗余标签。`,
        fail: `文本占比仅 ${pct}%，内容稀薄或代码臃肿。`,
      };
      const r = levelToResult(level, msg.pass, msg.warn, msg.fail);
      if (level === 'fail') r.fix = snippet('<main>\n  <h1>主题</h1>\n  <p>直接可读的正文内容，减少无意义嵌套。</p>\n</main>');
      return r;
    },
  },
  {
    id: 'keyword-focus',
    dimension: 'content',
    severity: 'minor',
    weight: 1,
    title: '主题关键词聚焦',
    description: '一页应聚焦一个主主题。检查 Title 中的关键词是否在 H1、描述和正文中自然出现，避免完全无关。',
    check: ({ page }) => {
      if (!page.title || !page.text) return info('缺少 Title 或正文，无法评估关键词聚焦。');
      const tokens = tokenize(page.title);
      if (!tokens.length) return info('Title 无法拆分出有效关键词（可能是纯符号）。');
      const body = `${page.description} ${page.text}`.toLowerCase();
      const hit = tokens.filter((t) => body.includes(t));
      const rate = hit.length / tokens.length;
      if (rate === 0) {
        return fail(`Title 关键词 [${tokens.slice(0, 3).join('、')}] 在正文中完全未出现，主题不一致。`);
      }
      if (rate < 0.5) {
        return warn(`Title 关键词仅 ${hit.length}/${tokens.length} 出现在正文中，主题一致性偏弱。`);
      }
      return pass(`Title 关键词 ${hit.length}/${tokens.length} 在正文中出现，主题聚焦。`);
    },
  },
  {
    id: 'content-structure',
    dimension: 'content',
    severity: 'minor',
    weight: 1,
    title: '正文分块清晰（段落/列表/表格）',
    description: '长文需要段落、列表、表格来提升可扫描性。纯文字大段落会让用户和 AI 摘要都难以提取要点。',
    check: ({ page }) => {
      const blocks = page.paragraphCount + page.listCount + page.tableCount;
      if (page.wordCount < 200) return info('内容较短，暂不评估分块结构。');
      if (blocks === 0) return fail('正文没有任何段落、列表或表格结构。', { fix: snippet('<p>段落</p>\n<ul><li>要点</li></ul>') });
      if (blocks < 5 && page.wordCount > 800) return warn(`正文 ${page.wordCount} 字但只有 ${blocks} 个结构块，建议拆分。`);
      return pass(`段落 ${page.paragraphCount} / 列表 ${page.listCount} / 表格 ${page.tableCount}，结构清晰。`);
    },
  },
  {
    id: 'thin-content-dupe',
    dimension: 'content',
    severity: 'minor',
    weight: 0.8,
    title: '无关键词堆砌',
    description: '正文中同一关键词密度超过 5% 会被判定为堆砌，收益为负。',
    check: ({ page }) => {
      if (page.wordCount < 150) return info('内容过短，跳过密度检测。');
      const top = page.keywords[0];
      if (!top) return info('无法提取关键词。');
      const density = top.count / Math.max(1, page.wordCount);
      const pct = (density * 100).toFixed(1);
      if (density > 0.08) return fail(`关键词「${top.keyword}」密度 ${pct}%，存在堆砌风险。`);
      if (density > 0.05) return warn(`关键词「${top.keyword}」密度 ${pct}%，略高。`);
      return pass(`最高频词「${top.keyword}」密度 ${pct}%，自然。`);
    },
  },
  {
    id: 'meta-keywords-obsolete',
    dimension: 'content',
    severity: 'minor',
    weight: 0.3,
    title: '不使用已废弃的 meta keywords',
    description: '主流搜索引擎早已忽略 meta keywords，它只会把关键词策略暴露给竞争对手。',
    check: ({ page }) => {
      if (!page.metaKeywords) return pass('未使用 meta keywords。');
      return warn(`检测到 meta keywords（${cut(page.metaKeywords, 60)}），建议移除。`, {
        fix: snippet('<!-- 删除这一行 -->\n<meta name="keywords" content="...">'),
      });
    },
  },
];

/** 拆关键词：英文按词，中文取 2-4 字片段 */
function tokenize(title) {
  const lower = title.toLowerCase();
  const out = new Set();
  const latin = lower.replace(/[^\p{L}\p{N}\s'’-]/gu, ' ').split(/\s+/);
  for (const w of latin) {
    if (w.length >= 3 && !/^\d+$/.test(w)) out.add(w);
  }
  const cjkRuns = lower.match(/[\u3400-\u4dbf\u4e00-\u9fff]{2,}/g) || [];
  for (const run of cjkRuns) {
    for (let size = Math.min(4, run.length); size >= 2; size--) {
      for (let i = 0; i + size <= run.length; i++) {
        out.add(run.slice(i, i + size));
        if (out.size > 30) return [...out];
      }
    }
  }
  return [...out].slice(0, 30);
}
