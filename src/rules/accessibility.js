import { pass, warn, fail, info, cut, snippet } from './helpers.js';

export const accessibilityRules = [
  {
    id: 'img-alt',
    dimension: 'accessibility',
    severity: 'major',
    weight: 2.5,
    title: '图片都有 alt 属性',
    description: 'alt 是图片的替代文本：读屏软件靠它朗读，图片加载失败时靠它显示，搜索引擎靠它理解图片内容。',
    check: ({ page }) => {
      if (!page.images.length) return info('页面无图片。');
      const missing = page.imagesNoAlt.length;
      if (missing === 0) {
        const empty = page.imagesEmptyAlt.length;
        return pass(`全部 ${page.images.length} 张图片都有 alt${empty ? `（${empty} 张为空，用于装饰图）` : ''}。`);
      }
      const ratio = missing / page.images.length;
      const samples = page.imagesNoAlt.slice(0, 3).map((i) => cut(i.src || '(无 src)', 50));
      if (ratio > 0.3) {
        return fail(`${missing}/${page.images.length} 张图片缺少 alt，如 ${samples.join('、')}。`, {
          fix: snippet('<img src="/chart.png" alt="2024 年流量增长趋势图" width="800" height="450">'),
        });
      }
      return warn(`${missing}/${page.images.length} 张图片缺少 alt：${samples.join('、')}。`, {
        fix: snippet('<img src="/chart.png" alt="图片内容描述">'),
      });
    },
  },
  {
    id: 'semantic-html',
    dimension: 'accessibility',
    severity: 'major',
    weight: 2,
    title: '使用语义化 HTML5 标签',
    description: 'main / nav / article / header / footer 让辅助技术和搜索引擎直接理解页面结构，比重重嵌套的 div 清晰得多。',
    check: ({ page }) => {
      const s = page.semantic;
      const found = [];
      if (s.main) found.push('main');
      if (s.nav) found.push('nav');
      if (s.article) found.push('article');
      if (s.header) found.push('header');
      if (s.footer) found.push('footer');
      if (!s.main && !s.article) {
        return fail('既没有 <main> 也没有 <article>，缺少主内容区域声明。', {
          fix: snippet('<body>\n  <header>…</header>\n  <nav>…</nav>\n  <main>\n    <article>…</article>\n  </main>\n  <footer>…</footer>\n</body>'),
        });
      }
      if (found.length <= 2) return warn(`仅使用了 ${found.join('、')}，可以使用更多语义标签（nav/article/section）。`);
      return pass(`语义标签：${found.join('、')}。`);
    },
  },
  {
    id: 'heading-not-empty',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 1,
    title: '标题标签内容非空',
    description: '空的 h1–h6 会打断读屏软件的标题导航，也对 SEO 无益。',
    check: ({ page }) => {
      const empty = page.headings.filter((h) => !h.text);
      if (empty.length === 0) return pass('所有标题标签都有文本。');
      return warn(`${empty.length} 个空标题标签（${empty.map((h) => 'H' + h.level).join('、')}）。`);
    },
  },
  {
    id: 'form-labels',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 1.5,
    title: '表单控件有可访问名称',
    description: '输入框需要 <label for> 或 aria-label，否则读屏用户不知道要填什么，也不符合 WCAG。',
    check: ({ page }) => {
      if (!page.forms.length) return info('页面无表单。');
      const inputNodes = [...page.doc.walk((n) => ['input', 'select', 'textarea'].includes(n.tag))];
      const unlabeled = inputNodes.filter((n) => {
        const type = (n.attrs.type || '').toLowerCase();
        if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return false;
        if (n.attrs['aria-label'] || n.attrs['aria-labelledby'] || n.attrs.title) return false;
        const id = n.attrs.id;
        if (id && [...page.doc.all('label')].some((l) => l.attrs.for === id)) return false;
        // 被 label 包裹
        let p = n.parent;
        while (p) { if (p.tag === 'label') return false; p = p.parent; }
        return true;
      });
      if (unlabeled.length === 0) return pass('所有表单控件都有可访问名称。');
      return warn(`${unlabeled.length} 个输入控件缺少 label / aria-label。`, {
        fix: snippet('<label for="email">邮箱</label>\n<input id="email" type="email" name="email">'),
      });
    },
  },
  {
    id: 'aria-usage',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 0.8,
    title: '使用 ARIA 增强可访问性',
    description: '对于 div 按钮、手风琴、弹窗等自定义组件，需要 role 与 aria-* 让辅助技术理解其行为。',
    check: ({ page }) => {
      const n = page.ariaNodeCount;
      if (n === 0) {
        if (page.stats.nodes > 200) return warn('页面元素较多但完全未使用 ARIA 属性。', { fix: snippet('<div role="button" tabindex="0" aria-label="关闭">✕</div>') });
        return info('页面结构简单，未使用 ARIA（可接受）。');
      }
      return pass(`使用了 ${n} 处 role / aria-* 属性。`);
    },
  },
  {
    id: 'skip-link',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 0.6,
    title: '提供跳转到主内容的链接',
    description: '键盘用户每次进入新页面都要 Tab 过整个导航。提供 "跳到主内容" 链接是 WCAG 2.4.1 要求。',
    check: ({ page }) => {
      if (page.hasSkipLink) return pass('检测到跳转主内容链接。');
      if (page.semantic.nav === 0) return info('页面无导航区，跳过链接收益有限。');
      return warn('未检测到 "跳到主内容" 链接，键盘用户操作成本较高。', {
        fix: snippet('<a class="skip-link" href="#main">跳到主内容</a>\n<a id="main"></a>'),
      });
    },
  },
  {
    id: 'lang-match',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 0.8,
    title: '页面语言与内容一致',
    description: 'lang 声明成 en 但内容是中文，会让读屏软件用英文语音引擎朗读，完全听不懂。',
    check: ({ page }) => {
      if (!page.lang) return info('未声明 lang，跳过语言一致性检测。');
      const hasCjk = /[\u3400-\u4dbf\u4e00-\u9fff]/.test(page.text.slice(0, 3000));
      const cjkRatio = (page.text.slice(0, 3000).match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length / Math.max(1, Math.min(3000, page.text.length));
      const declaredZh = /^zh/i.test(page.lang);
      const declaredEn = /^en/i.test(page.lang);
      if (hasCjk && cjkRatio > 0.2 && declaredEn) return warn(`页面内容是中文（CJK 占比 ${(cjkRatio * 100).toFixed(0)}%），但 lang="${page.lang}"。`, { fix: snippet('<html lang="zh-CN">') });
      if (!hasCjk && declaredZh && page.text.length > 300) return warn(`lang="${page.lang}" 但正文以非中文为主。`);
      return pass(`lang="${page.lang}" 与内容语言匹配。`);
    },
  },
  {
    id: 'iframe-title',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 0.6,
    title: 'iframe 有 title 描述',
    description: 'iframe 的 title 是读屏软件唯一能告知用户"这块区域是什么"的信息。',
    check: ({ page }) => {
      if (!page.iframes.length) return info('页面无 iframe。');
      const missing = page.iframes.filter((f) => !f.title).length;
      if (missing === 0) return pass(`全部 ${page.iframes.length} 个 iframe 都有 title。`);
      return warn(`${missing}/${page.iframes.length} 个 iframe 缺少 title 属性。`, {
        fix: snippet('<iframe src="/map" title="门店位置地图"></iframe>'),
      });
    },
  },
  {
    id: 'tabindex-misuse',
    dimension: 'accessibility',
    severity: 'minor',
    weight: 0.5,
    title: '未滥用正数 tabindex',
    description: 'tabindex="1" 及以上的值会打乱自然的 Tab 顺序，让键盘导航变得不可预测。',
    check: ({ page }) => {
      const bad = [...page.doc.walk((n) => Number(n.attrs.tabindex) > 0)];
      if (bad.length === 0) return pass('未发现正数 tabindex。');
      return warn(`${bad.length} 个元素使用了正数 tabindex，会打乱自然焦点顺序。`, {
        fix: snippet('<!-- 保持 DOM 顺序，移除 tabindex，或用 tabindex="0" -->'),
      });
    },
  },
];
