import { TtlCache } from '../core/cache.js';
import { analyzeUrl } from '../core/analyzer.js';
import { serializeReport } from '../core/serialize.js';
import { normalizeTarget } from '../util/url.js';
import { gradeOf } from '../core/score.js';

const cache = new TtlCache({ ttlMs: 10 * 60_000, maxEntries: 256 });

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

const STYLES = {
  flat: (color) => ({ bg: '#555', fg: '#fff', color }),
  'flat-square': (color) => ({ bg: '#555', fg: '#fff', color, radius: 0 }),
  plastic: (color) => ({ bg: '#555', fg: '#fff', color }),
};

/**
 * 生成 shields.io 风格的 SVG 徽章。
 * 零外部依赖，字宽估算采用 6.2px/字符 + 10px 边距，足够接近而不会明显错位。
 */
export function renderBadge({ label, message, color, style = 'flat', labelColor }) {
  const st = STYLES[style] || STYLES.flat;
  const radius = st.radius ?? 3;
  const pad = 5;
  const charW = 6.2;
  const labelW = Math.round(label.length * charW) + pad * 2 + 2;
  const msgW = Math.round(message.length * charW) + pad * 2 + 2;
  const totalW = labelW + msgW;
  const h = 20;
  const fontSize = 11;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${h}" viewBox="0 0 ${totalW} ${h}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <title>${escapeXml(label)}: ${escapeXml(message)}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalW}" height="${h}" rx="${radius}" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${h}" fill="${labelColor || st.bg}"/>
    <rect x="${labelW}" width="${msgW}" height="${h}" fill="${color}"/>
    <rect width="${totalW}" height="${h}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}">
    <text x="${labelW / 2}" y="${h - 6}" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text>
    <text x="${labelW / 2}" y="${h - 7}">${escapeXml(label)}</text>
    <text x="${labelW + msgW / 2}" y="${h - 6}" fill="#010101" fill-opacity=".3">${escapeXml(message)}</text>
    <text x="${labelW + msgW / 2}" y="${h - 7}">${escapeXml(message)}</text>
  </g>
</svg>`;
}

export function createBadgeApi(cfg, store, ctx) {
  return {
    /** 直接给 URL 生成徽章 SVG（带缓存，避免每次刷新都重新抓站） */
    async forUrl(rawUrl, { style = 'flat', label = 'SEO' } = {}) {
      const url = normalizeTarget(rawUrl).toString();
      const key = `${url}|${style}|${label}`;
      const hit = cache.get(key);
      if (hit) return hit;

      let entry;
      const latest = store.latestByUrl(url);
      const recent = latest && Date.now() - latest.createdAt < cfg.cache.ttlMs;
      if (recent) {
        entry = { score: latest.score, grade: latest.grade };
      } else {
        try {
          const report = await analyzeUrl(url, cfg, { skipAux: true });
          store.saveAudit({
            url: report.url, finalUrl: report.finalUrl, host: report.host,
            score: report.score, grade: report.grade, blocked: report.blocked,
            counts: report.summary, contentHash: report.contentHash,
            durationMs: report.durationMs, mode: 'badge', report: serializeReport(report),
          });
          entry = { score: report.score, grade: report.grade };
        } catch (err) {
          entry = { error: err.code || 'error', message: err.message };
          cache.set(key, entry, 60_000);
          return entry;
        }
      }
      const grade = gradeOf(entry.score);
      const svg = renderBadge({ label, message: `${entry.score} ${grade.grade}`, color: grade.color, style });
      const out = { svg, score: entry.score, grade: grade.grade };
      cache.set(key, out);
      ctx.metrics.incr('badge.generated');
      return out;
    },

    /** 用已有报告生成徽章，零成本 */
    fromScore(score, { style = 'flat', label = 'SEO' } = {}) {
      const grade = gradeOf(score);
      return renderBadge({ label, message: `${score} ${grade.grade}`, color: grade.color, style });
    },
  };
}
