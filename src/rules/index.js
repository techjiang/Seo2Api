import { contentRules } from './content.js';
import { technicalRules } from './technical.js';
import { performanceRules } from './performance.js';
import { socialRules } from './social.js';
import { accessibilityRules } from './accessibility.js';
import { securityRules } from './security.js';
import { discoverabilityRules } from './discoverability.js';
import { aiReadinessRules } from './ai.js';

/**
 * 维度定义。weight 之和为 1，决定总分构成。
 * 权重经过校准：内容质量与可发现性对排名影响最大，AI 可读性是本系统的创新维度。
 */
export const DIMENSIONS = [
  { key: 'content', name: '内容质量', weight: 0.22, icon: 'content', desc: '标题、描述、正文、标题层级、关键词' },
  { key: 'technical', name: '技术规范', weight: 0.18, icon: 'technical', desc: '可索引性、canonical、结构化数据、移动适配' },
  { key: 'performance', name: '性能与体验', weight: 0.16, icon: 'performance', desc: '体积、阻塞资源、图片、缓存与压缩' },
  { key: 'discoverability', name: '可发现性', weight: 0.14, icon: 'discoverability', desc: 'robots、sitemap、内链、hreflang' },
  { key: 'social', name: '社交与摘要', weight: 0.10, icon: 'social', desc: 'Open Graph、Twitter Card、分享图' },
  { key: 'accessibility', name: '可访问性', weight: 0.10, icon: 'accessibility', desc: '语义化、alt、对比、键盘可用' },
  { key: 'security', name: '安全性', weight: 0.05, icon: 'security', desc: 'HTTPS、安全响应头、混合内容' },
  { key: 'ai', name: 'AI 可读性', weight: 0.05, icon: 'ai', desc: 'llms.txt、问答结构、可抽取事实（创新维度）' },
];

export const RULES = [
  ...contentRules,
  ...technicalRules,
  ...performanceRules,
  ...discoverabilityRules,
  ...socialRules,
  ...accessibilityRules,
  ...securityRules,
  ...aiReadinessRules,
];

export const RULE_MAP = new Map(RULES.map((r) => [r.id, r]));

export const RULES_BY_DIMENSION = DIMENSIONS.reduce((acc, d) => {
  acc[d.key] = RULES.filter((r) => r.dimension === d.key);
  return acc;
}, {});

// 启动时做一致性校验，防止规则写错 id/维度导致静默失效
{
  const seen = new Set();
  for (const r of RULES) {
    if (!r.id || seen.has(r.id)) throw new Error(`规则 id 重复或缺失: ${r.id}`);
    seen.add(r.id);
    if (!DIMENSIONS.some((d) => d.key === r.dimension)) throw new Error(`规则 ${r.id} 的维度非法: ${r.dimension}`);
    if (typeof r.check !== 'function') throw new Error(`规则 ${r.id} 缺少 check 函数`);
    if (!['critical', 'major', 'minor'].includes(r.severity)) throw new Error(`规则 ${r.id} 的 severity 非法: ${r.severity}`);
    if (!(r.weight > 0)) throw new Error(`规则 ${r.id} 的 weight 非法: ${r.weight}`);
  }
}
