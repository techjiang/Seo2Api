/**
 * 落库前的报告瘦身：去掉可从 page 摘要推导的大字段，控制单条记录体积。
 * 保留全部 checks（用户最需要）、priority、dimensions、summary。
 */
const MAX_CHECKS = 200;

export function serializeReport(report) {
  return {
    ...report,
    checks: report.checks.slice(0, MAX_CHECKS).map((c) => ({
      id: c.id,
      dimension: c.dimension,
      severity: c.severity,
      weight: c.weight,
      title: c.title,
      description: c.description,
      status: c.status,
      message: c.message,
      fix: c.fix,
      details: c.details,
    })),
    page: report.page ? {
      ...report.page,
      headingOutline: (report.page.headingOutline || []).slice(0, 20),
      keywords: (report.page.keywords || []).slice(0, 6),
    } : null,
  };
}

/** 对外输出的精简版：只要分数和关键问题，适合批量场景 */
export function compactReport(report) {
  return {
    id: report.id,
    url: report.url,
    finalUrl: report.finalUrl,
    score: report.score,
    grade: report.grade,
    gradeLabel: report.gradeLabel,
    blocked: report.blocked,
    summary: report.summary,
    dimensions: (report.dimensions || []).map((d) => ({ key: d.key, name: d.name, score: d.score })),
    topIssues: (report.priority || []).slice(0, 5).map((p) => ({ id: p.id, title: p.title, severity: p.severity, status: p.status, estimatedGain: p.estimatedGain })),
    analyzedAt: report.analyzedAt,
    reportUrl: report.reportUrl,
  };
}
