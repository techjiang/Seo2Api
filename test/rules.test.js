import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, DIMENSIONS, RULE_MAP, RULES_BY_DIMENSION } from '../src/rules/index.js';
import { evaluateRules, overallScore, gradeOf, prioritize, summarize } from '../src/core/score.js';
import { buildPageModel } from '../src/core/page.js';
import { bestPageHtml, worstPageHtml } from './helpers.js';

const buildCtx = (html, { url = 'https://good.example/' } = {}) => {
  const fetched = { html, status: 200, finalUrl: url, headers: { 'content-type': 'text/html; charset=utf-8' }, contentType: 'text/html; charset=utf-8', charset: 'utf-8', elapsedMs: 120, redirects: [] };
  const page = buildPageModel(fetched, { targetUrl: url });
  return { page, aux: null, cfg: {}, response: fetched, url };
};

test('规则集自身完整性', async (t) => {
  await t.test('每条规则结构合法', () => {
    const ids = new Set();
    for (const r of RULES) {
      assert.ok(r.id && typeof r.id === 'string', 'id 必须是非空字符串');
      assert.ok(!ids.has(r.id), `id 重复: ${r.id}`);
      ids.add(r.id);
      assert.ok(DIMENSIONS.some((d) => d.key === r.dimension), `维度非法: ${r.id}`);
      assert.ok(['critical', 'major', 'minor'].includes(r.severity), `severity 非法: ${r.id}`);
      assert.ok(r.weight > 0, `weight 必须为正: ${r.id}`);
      assert.equal(typeof r.check, 'function');
      assert.ok(r.title && r.description, `${r.id} 缺少 title/description`);
    }
  });

  await t.test('每个维度都有规则', () => {
    for (const d of DIMENSIONS) {
      assert.ok(RULES_BY_DIMENSION[d.key].length >= 5, `${d.key} 规则过少`);
    }
  });

  await t.test('维度权重之和为 1', () => {
    const sum = DIMENSIONS.reduce((a, d) => a + d.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `权重和应为 1，实际 ${sum}`);
  });

  await t.test('规则 id 与查询索引一致', () => {
    assert.equal(RULE_MAP.size, RULES.length);
  });
});

test('规则在极端输入下不崩溃', async (t) => {
  const cases = {
    '空文档': '',
    '只有 doctype': '<!doctype html>',
    '未闭合标签': '<html><head><title>x</title><body><div><p>a<span>b',
    '乱码属性': '<html><body><img src="a.png" alt=><a href=>x</a></body></html>',
    '嵌套极深': '<div>'.repeat(500) + 'deep' + '</div>'.repeat(500),
    '注释与脚本': '<html><head><title>t</title><script>var a="</div>";</script></head><body><p>x</p></body></html>',
    '纯空白': '   \n\t  ',
    '超长标题': `<html><head><title>${'长'.repeat(500)}</title></head><body><h1>${'长'.repeat(300)}</h1></body></html>`,
  };

  for (const [name, html] of Object.entries(cases)) {
    await t.test(name, () => {
      const ctx = buildCtx(html);
      const results = evaluateRules(ctx);
      assert.equal(results.length, RULES.length, '每条规则都应有结果');
      for (const r of results) {
        assert.ok(['pass', 'warn', 'fail', 'info', 'skip'].includes(r.status), `${r.id} 状态非法`);
        assert.equal(typeof r.message, 'string', `${r.id} 的 message 必须是字符串`);
        assert.ok(r.message.length > 0, `${r.id} 的 message 不能为空`);
      }
      const scored = overallScore(results);
      assert.ok(scored.score >= 0 && scored.score <= 100, `分数越界: ${scored.score}`);
    });
  }
});

test('好的页面得高分，差的页面得低分', async (t) => {
  await t.test('完备页面 ≥ 75 分', () => {
    const ctx = buildCtx(bestPageHtml());
    const results = evaluateRules(ctx);
    const scored = overallScore(results);
    const fails = results.filter((r) => r.status === 'fail');
    assert.ok(scored.score >= 75, `分数过低: ${scored.score}，失败项: ${fails.map((f) => f.id).join(',')}`);
  });

  await t.test('空壳页面 ≤ 45 分', () => {
    const ctx = buildCtx(worstPageHtml());
    const results = evaluateRules(ctx);
    const scored = overallScore(results);
    assert.ok(scored.score <= 45, `分数过高: ${scored.score}`);
  });

  await t.test('关键项失败会显著拉低分数', () => {
    const good = overallScore(evaluateRules(buildCtx(bestPageHtml())));
    const noindexHtml = bestPageHtml().replace('<head>', '<head><meta name="robots" content="noindex">');
    const bad = overallScore(evaluateRules(buildCtx(noindexHtml)));
    assert.ok(bad.score < good.score - 10, `noindex 应显著降分：${good.score} → ${bad.score}`);
    assert.ok(bad.score <= 35, `noindex 应触发硬性封顶，实际 ${bad.score}`);
    assert.equal(bad.blocked, true);
  });
});

test('评分与优先级', async (t) => {
  const ctx = buildCtx(worstPageHtml());
  const results = evaluateRules(ctx);
  const scored = overallScore(results);

  await t.test('各维度分在 0–100', () => {
    for (const d of Object.values(scored.dimensions)) {
      assert.ok(d.score >= 0 && d.score <= 100, `${d.key}: ${d.score}`);
    }
  });

  await t.test('等级映射单调', () => {
    const grades = [0, 40, 55, 70, 80, 90, 97].map((s) => gradeOf(s).grade);
    assert.deepEqual(grades, ['F', 'F', 'D', 'C', 'B', 'A', 'A+']);
  });

  await t.test('优先级按性价比降序', () => {
    const priority = prioritize(results, scored.dimensions);
    assert.ok(priority.length > 0);
    for (let i = 1; i < priority.length; i++) {
      assert.ok(priority[i - 1].ratio >= priority[i].ratio, '未按 ratio 降序');
    }
    for (const p of priority) {
      assert.ok(p.estimatedGain >= 0, '收益不能为负');
      assert.ok(['fail', 'warn'].includes(p.status), '只应包含问题项');
    }
  });

  await t.test('摘要包含可读结论', () => {
    const s = summarize(scored.score, scored.dimensions, results, prioritize(results, scored.dimensions));
    assert.equal(typeof s.headline, 'string');
    assert.ok(s.headline.length > 5);
    assert.ok(s.lines.length >= 1);
    assert.equal(s.checkedCount + results.filter((r) => r.status === 'info' || r.status === 'skip').length, results.length);
  });
});

test('规则检查在真实页面上的正误', async (t) => {
  await t.test('标题过短报 warn 或 fail', () => {
    const html = '<html lang="en"><head><title>a</title></head><body><h1>a</h1></body></html>';
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'title-length');
    assert.ok(['warn', 'fail'].includes(r.status));
  });

  await t.test('缺失 description 报 fail', () => {
    const html = '<html lang="en"><head><title>正常长度的标题文本内容</title></head><body><h1>x</h1></body></html>';
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'description-exists');
    assert.equal(r.status, 'fail');
    assert.ok(r.fix, '应给出修复代码');
  });

  await t.test('多个 H1 报 fail', () => {
    const html = '<html lang="en"><head><title>正常长度的标题文本内容</title></head><body><h1>a</h1><h1>b</h1></body></html>';
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'h1-single');
    assert.equal(r.status, 'fail');
  });

  await t.test('有 noindex 报 fail', () => {
    const html = '<html lang="en"><head><meta name="robots" content="noindex, follow"><title>正常长度标题内容文本</title></head><body><h1>a</h1></body></html>';
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'indexable');
    assert.equal(r.status, 'fail');
  });

  await t.test('图片缺 alt 报 fail', () => {
    const html = '<html lang="en"><head><title>正常长度的标题文本内容</title></head><body><h1>a</h1><img src="a.png"><img src="b.png"><img src="c.png"></body></html>';
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'img-alt');
    assert.equal(r.status, 'fail');
  });

  await t.test('装饰性空 alt 不报错', () => {
    const html = '<html lang="en"><head><title>正常长度的标题文本内容</title></head><body><h1>a</h1><img src="a.png" alt=""></body></html>';
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'img-alt');
    assert.equal(r.status, 'pass');
  });

  await t.test('英文页面用 lang=zh 报 warn', () => {
    const longEn = 'This is an English paragraph about search engine optimization and its practices. '.repeat(12);
    const html = `<html lang="zh-CN"><head><title>English page about SEO</title></head><body><h1>Hello</h1><p>${longEn}</p></body></html>`;
    const r = evaluateRules(buildCtx(html)).find((x) => x.id === 'lang-match');
    assert.equal(r.status, 'warn');
  });
});
