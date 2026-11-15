import { DIMENSIONS, RULES, RULES_BY_DIMENSION } from '../rules/index.js';

const STATUS_VALUE = { pass: 1, warn: 0.45, fail: 0, info: 1, skip: 1 };
const SEVERITY_IMPACT = { critical: 3, major: 2, minor: 1 };
const STATUS_IMPACT = { fail: 1, warn: 0.45, info: 0, skip: 0, pass: 0 };

/**
 * 计算单条规则得分：权重和状态都参与，让"关键项失败"更疼。
 */
export function evaluateRules(ctx, { includeStatus = ['pass', 'warn', 'fail', 'info', 'skip'] } = {}) {
  const results = [];
  for (const rule of RULES) {
    let outcome;
    try {
      outcome = rule.check(ctx) || { status: 'skip', message: '规则未返回结果' };
    } catch (err) {
      outcome = { status: 'skip', message: `规则执行异常: ${err.message}` };
    }
    if (!includeStatus.includes(outcome.status)) continue;
    // 兜底：规则作者写错 message 时不能让 undefined 流到报告里
    if (typeof outcome.message !== 'string' || !outcome.message) {
      outcome.message = `${rule.title}：未得到明确结论`;
    }
    results.push({
      id: rule.id,
      dimension: rule.dimension,
      severity: rule.severity,
      weight: rule.weight,
      title: rule.title,
      description: rule.description,
      status: outcome.status,
      message: outcome.message,
      fix: outcome.fix || null,
      details: outcome.details || null,
    });
  }
  return results;
}

/** 维度得分：加权通过率，映射到 0–100 */
export function dimensionScore(results) {
  let weightSum = 0;
  let scoreSum = 0;
  let counted = 0;
  for (const r of results) {
    if (r.status === 'info' || r.status === 'skip') continue;
    counted++;
    weightSum += r.weight;
    scoreSum += r.weight * (STATUS_VALUE[r.status] ?? 1);
  }
  if (weightSum === 0) return { score: 100, counted, weightSum };
  return { score: Math.round((scoreSum / weightSum) * 1000) / 10, counted, weightSum };
}

/**
 * 总分：维度加权几何平均与算术平均的混合。
 * 为什么不全用算术平均：一个 critical 维度（如"页面根本不允许索引"）崩了，
 * 其它维度再好整体也不可用。几何均值能惩罚这种短板效应，同时保留区分度。
 */
export function overallScore(results) {
  const perDimension = {};
  for (const dim of DIMENSIONS) {
    const dimResults = results.filter((r) => r.dimension === dim.key);
    const { score, counted } = dimensionScore(dimResults);
    perDimension[dim.key] = {
      key: dim.key,
      name: dim.name,
      icon: dim.icon,
      desc: dim.desc,
      weight: dim.weight,
      score,
      checked: counted,
      counts: tally(dimResults),
    };
  }
  const usable = DIMENSIONS.filter((d) => perDimension[d.key].checked > 0);
  const weightSum = usable.reduce((a, d) => a + d.weight, 0) || 1;

  let arithmetic = 0;
  let logSum = 0;
  for (const d of usable) {
    const s = perDimension[d.key].score;
    const w = d.weight / weightSum;
    arithmetic += s * w;
    logSum += w * Math.log(Math.max(s, 0.5));
  }
  const geometric = Math.exp(logSum);
  const blended = 0.7 * arithmetic + 0.3 * geometric;

  // 硬惩罚：不可索引 / HTTP 失败，直接压到 40 以下，避免"高分却无法收录"
  const blockers = results.filter((r) => r.status === 'fail' && r.id === 'indexable');
  const finalScore = blockers.length ? Math.min(blended, 35) : blended;

  return {
    score: Math.round(finalScore * 10) / 10,
    arithmetic: Math.round(arithmetic * 10) / 10,
    geometric: Math.round(geometric * 10) / 10,
    blocked: blockers.length > 0,
    dimensions: perDimension,
  };
}

function tally(results) {
  const out = { pass: 0, warn: 0, fail: 0, info: 0, skip: 0 };
  for (const r of results) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}

export function gradeOf(score) {
  if (score >= 95) return { grade: 'A+', label: '卓越', color: '#16a34a' };
  if (score >= 88) return { grade: 'A', label: '优秀', color: '#22c55e' };
  if (score >= 78) return { grade: 'B', label: '良好', color: '#84cc16' };
  if (score >= 65) return { grade: 'C', label: '及格', color: '#eab308' };
  if (score >= 50) return { grade: 'D', label: '待改进', color: '#f97316' };
  return { grade: 'F', label: '不合格', color: '#ef4444' };
}

/**
 * 修复优先级：impact / effort。
 * impact 由「严重度 × 规则权重 × 维度权重」推出，effort 由规则元数据给出。
 * 这样用户拿到的是"先改这三个，分数涨多少"的清单，而不是一堆平铺的问题。
 */
const EFFORT_BY_RULE = {
  'title-exists': 1, 'title-length': 1, 'description-exists': 1, 'description-length': 1,
  'h1-single': 1, 'lang-attribute': 1, 'viewport': 1, 'charset': 1, 'doctype': 1, 'canonical': 1,
  'og-basic': 2, 'og-image': 2, 'twitter-card': 2, 'robots-txt': 2, 'sitemap': 2, 'favicon': 1,
  'img-alt': 3, 'image-alt-and-dims': 3, 'structured-data': 4, 'llms-txt': 2, 'faq-structure': 3,
  'https': 4, 'hsts': 1, 'compression': 1, 'http-caching': 1, 'render-blocking': 3,
  'semantic-html': 3, 'content-length': 5, 'self-contained-paragraphs': 4,
};

export function prioritize(results, dimensions) {
  const items = [];
  for (const r of results) {
    if (r.status !== 'fail' && r.status !== 'warn') continue;
    const dimWeight = DIMENSIONS.find((d) => d.key === r.dimension)?.weight ?? 0.1;
    const impact = SEVERITY_IMPACT[r.severity] * r.weight * dimWeight * STATUS_IMPACT[r.status] * 10;
    const effort = EFFORT_BY_RULE[r.id] ?? (r.severity === 'critical' ? 2 : r.severity === 'major' ? 3 : 2);
    // 预估分数提升：把该条修成 pass 后的增量。
    // 维度分 = 该维度加权通过率；总分 ≈ Σ(维度分 × 维度权重)，所以：
    //   Δ维度分 = weight / 维度总权重 × 100 × 当前损失比例
    //   Δ总分   = Δ维度分 × 维度权重
    const dimWeightSum = RULES_BY_DIMENSION[r.dimension].reduce((a, x) => a + x.weight, 0);
    const gain = dimWeightSum > 0
      ? (r.weight / dimWeightSum) * dimWeight * STATUS_IMPACT[r.status] * 100
      : 0;
    items.push({
      id: r.id,
      title: r.title,
      dimension: r.dimension,
      dimensionName: dimensions[r.dimension]?.name || r.dimension,
      severity: r.severity,
      status: r.status,
      message: r.message,
      fix: r.fix,
      details: r.details,
      impact: Math.round(impact * 100) / 100,
      effort,
      estimatedGain: Math.round(gain * 10) / 10,
      ratio: Math.round((impact / effort) * 100) / 100,
    });
  }
  items.sort((a, b) => b.ratio - a.ratio || b.impact - a.impact);
  return items;
}

/** 生成给用户看的结论摘要 */
export function summarize(score, dimensions, results, priority) {
  const fails = results.filter((r) => r.status === 'fail');
  const warns = results.filter((r) => r.status === 'warn');
  const criticals = fails.filter((r) => r.severity === 'critical');
  const grade = gradeOf(score);
  const weakest = Object.values(dimensions)
    .filter((d) => d.checked > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
  const strongest = Object.values(dimensions)
    .filter((d) => d.checked > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  const lines = [];
  // critical 是「严重度高」，不等于「会阻断收录」：HTTPS、viewport 这类
  // 属于必须修但不影响爬虫索引。真正阻断收录的只有 noindex、4xx/5xx、robots 屏蔽。
  // 之前统一说成「直接阻止页面被正常收录」，是错误结论，会误导用户判断优先级。
  const blockingIds = new Set(['indexable', 'http-status', 'robots-allows-page']);
  const blockers = fails.filter((r) => blockingIds.has(r.id));
  if (blockers.length) {
    lines.push(`发现 ${blockers.length} 个会阻断收录的问题，建议立即修复：${blockers.slice(0, 3).map((r) => r.title).join('、')}。`);
    if (fails.length > blockers.length) {
      lines.push(`另有 ${criticals.filter((r) => !blockingIds.has(r.id)).length} 个严重项与 ${fails.length - blockers.length - criticals.filter((r) => !blockingIds.has(r.id)).length} 个普通失败项，属于扣分但不会导致无法收录。`);
    }
  } else if (criticals.length) {
    lines.push(`没有阻断收录的问题，但有 ${criticals.length} 个严重项必修：${criticals.slice(0, 3).map((r) => r.title).join('、')}。`);
  } else if (fails.length) {
    lines.push(`没有致命阻断项，但有 ${fails.length} 项明确失败，是当前分数的主要失分点。`);
  } else if (warns.length) {
    lines.push(`没有失败项，还有 ${warns.length} 处细节可以打磨。`);
  } else {
    lines.push('所有检查项均通过，页面状态很好。');
  }
  if (weakest.length) {
    lines.push(`最弱环节：${weakest.map((d) => `${d.name}（${d.score}）`).join('、')}；最强环节：${strongest.map((d) => `${d.name}（${d.score}）`).join('、')}。`);
  }
  if (priority.length) {
    const top = priority.slice(0, 3);
    const totalGain = top.reduce((a, x) => a + x.estimatedGain, 0);
    lines.push(`优先修这三项，预计总分可提升约 ${totalGain.toFixed(1)} 分：${top.map((x) => `${x.title}（+${x.estimatedGain}）`).join('、')}。`);
  }

  return {
    grade: grade.grade,
    label: grade.label,
    color: grade.color,
    headline: lines[0],
    lines,
    criticalCount: criticals.length,
    failCount: fails.length,
    warnCount: warns.length,
    passCount: results.filter((r) => r.status === 'pass').length,
    checkedCount: results.filter((r) => r.status !== 'info' && r.status !== 'skip').length,
  };
}
