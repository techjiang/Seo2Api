import { pass, warn, fail, info, cut, snippet } from './helpers.js';

export const securityRules = [
  {
    id: 'https',
    dimension: 'security',
    severity: 'critical',
    weight: 3,
    title: '使用 HTTPS 加密传输',
    description: 'HTTPS 是 Google 明确的排名信号，也是浏览器标记"不安全"的分界线。',
    check: ({ page }) => {
      if (page.finalUrl.startsWith('https://')) return pass('通过 HTTPS 访问。');
      return fail('页面使用 HTTP，浏览器会标记为"不安全"，且是负面排名信号。', {
        fix: snippet('# Nginx\nserver {\n  listen 80;\n  return 301 https://$host$request_uri;\n}'),
      });
    },
  },
  {
    id: 'http-to-https-redirect',
    dimension: 'security',
    severity: 'major',
    weight: 2,
    title: 'HTTP 自动跳转到 HTTPS',
    description: '必须把 http:// 永久（301）跳转到 https://，否则存在重复内容与降级攻击风险。',
    check: ({ page, aux }) => {
      if (!page.finalUrl.startsWith('https:')) return info('当前非 HTTPS，跳过跳转检测。');
      const r = aux?.httpsRedirect;
      if (!r) return info('未能检测 http 跳转行为。');
      if (r.redirectsToHttps === true) return pass('http 已 301 跳转到 https。');
      if (r.redirectsToHttps === false) return fail('http 未跳转到 https，存在重复内容与安全问题。', {
        fix: snippet('# Nginx\nserver {\n  listen 80;\n  server_name example.com;\n  return 301 https://$host$request_uri;\n}'),
      });
      return info(`http 跳转检测未完成（${r.note || '未知原因'}）。`);
    },
  },
  {
    id: 'hsts',
    dimension: 'security',
    severity: 'major',
    weight: 2,
    title: '启用了 HSTS',
    description: 'Strict-Transport-Security 告诉浏览器以后只用 HTTPS 访问，可防 SSL 剥离攻击，也能省掉首跳延迟。',
    check: ({ page }) => {
      const hsts = page.securityHeaders.hsts;
      if (!hsts) {
        return warn('未设置 Strict-Transport-Security。', {
          fix: snippet('# Nginx\nadd_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'),
        });
      }
      const maxAge = Number(/max-age=(\d+)/i.exec(hsts)?.[1] || 0);
      if (maxAge < 15_552_000) return warn(`HSTS max-age=${maxAge} 秒，建议至少 180 天（15552000）。`);
      return pass(`HSTS 已启用（${cut(hsts, 60)}）。`);
    },
  },
  {
    id: 'x-content-type-options',
    dimension: 'security',
    severity: 'minor',
    weight: 1,
    title: '设置 X-Content-Type-Options',
    description: 'nosniff 阻止浏览器猜测 MIME 类型，避免把用户上传的图片当脚本执行。',
    check: ({ page }) => {
      const v = page.securityHeaders.xContentTypeOptions.toLowerCase();
      if (v === 'nosniff') return pass('X-Content-Type-Options: nosniff');
      return warn('未设置 X-Content-Type-Options: nosniff。', {
        fix: snippet('# Nginx\nadd_header X-Content-Type-Options "nosniff" always;'),
      });
    },
  },
  {
    id: 'clickjacking-protection',
    dimension: 'security',
    severity: 'minor',
    weight: 1,
    title: '防点击劫持（CSP frame-ancestors / X-Frame-Options）',
    description: '没有防护时，攻击者可以用透明 iframe 覆盖你的页面诱导用户点击。',
    check: ({ page }) => {
      const csp = page.securityHeaders.csp.toLowerCase();
      const xfo = page.securityHeaders.xFrameOptions.toLowerCase();
      if (/frame-ancestors/.test(csp)) return pass('CSP frame-ancestors 已设置。');
      if (xfo === 'deny' || xfo === 'sameorigin') return pass(`X-Frame-Options: ${xfo}`);
      return warn('未设置 X-Frame-Options 或 CSP frame-ancestors。', {
        fix: snippet('# Nginx\nadd_header X-Frame-Options "SAMEORIGIN" always;'),
      });
    },
  },
  {
    id: 'referrer-policy',
    dimension: 'security',
    severity: 'minor',
    weight: 0.8,
    title: '设置 Referrer-Policy',
    description: '默认策略会把完整 URL（可能含敏感参数）泄露给第三方站点。',
    check: ({ page }) => {
      const v = page.securityHeaders.referrerPolicy.toLowerCase();
      if (!v) return warn('未设置 Referrer-Policy。', { fix: snippet('# Nginx\nadd_header Referrer-Policy "strict-origin-when-cross-origin" always;') });
      if (/unsafe-url|no-referrer-when-downgrade/.test(v)) return warn(`Referrer-Policy 为 ${v}，会泄露完整来源 URL。`);
      return pass(`Referrer-Policy: ${v}`);
    },
  },
  {
    id: 'csp',
    dimension: 'security',
    severity: 'minor',
    weight: 1.2,
    title: '配置内容安全策略（CSP）',
    description: 'CSP 是 XSS 的最后一道防线。哪怕只做 report-only 也远好过没有。',
    check: ({ page }) => {
      const csp = page.securityHeaders.csp;
      if (!csp) return warn('未设置 Content-Security-Policy。', {
        fix: snippet('# Nginx（先以 Report-Only 观察）\nadd_header Content-Security-Policy-Report-Only "default-src \'self\'; img-src \'self\' data: https:; object-src \'none\'; base-uri \'self\'" always;'),
      });
      if (/unsafe-eval/.test(csp)) return warn('CSP 包含 unsafe-eval，削弱了防护效果。');
      if (/(default-src|script-src)\s+[^;]*\*/.test(csp)) return warn('CSP 使用了通配符 *，防护效果有限。');
      return pass('CSP 已启用。');
    },
  },
  {
    id: 'mixed-content',
    dimension: 'security',
    severity: 'major',
    weight: 1.5,
    title: '无混合内容（HTTPS 页面加载 HTTP 资源）',
    description: 'HTTPS 页面引用了 HTTP 的图片/脚本，浏览器会拦截或降级警告，用户看到"不安全"。',
    check: ({ page }) => {
      if (!page.finalUrl.startsWith('https:')) return info('非 HTTPS 页面，跳过混合内容检测。');
      const mixed = [];
      for (const img of page.images) if (img.src?.startsWith('http://')) mixed.push(img.src);
      for (const s of page.scripts) if (s.src?.startsWith('http://')) mixed.push(s.src);
      for (const c of page.stylesheets) if (c.href?.startsWith('http://')) mixed.push(c.href);
      for (const f of page.iframes) if (f.src?.startsWith('http://')) mixed.push(f.src);
      if (mixed.length === 0) return pass('未发现混合内容。');
      if (mixed.length <= 2) return warn(`${mixed.length} 处资源使用 http：${mixed.map((m) => cut(m, 50)).join('、')}。`, { fix: snippet('把所有 http:// 资源地址改为 https://') });
      return fail(`${mixed.length} 处资源使用 http，会被浏览器拦截。`, {
        details: mixed.slice(0, 5).map((m) => cut(m, 90)),
        fix: snippet('<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">'),
      });
    },
  },
  {
    id: 'server-disclosure',
    dimension: 'security',
    severity: 'minor',
    weight: 0.5,
    title: '未暴露服务器版本信息',
    description: 'Server / X-Powered-By 暴露具体版本号，会帮攻击者缩小漏洞匹配范围。',
    check: ({ page }) => {
      const server = page.negotiated.server;
      const powered = page.negotiated.poweredBy;
      const leaks = [];
      if (server && /\d+\.\d+/.test(server)) leaks.push(`Server: ${cut(server, 40)}`);
      if (powered) leaks.push(`X-Powered-By: ${cut(powered, 40)}`);
      if (leaks.length === 0) return pass('未暴露详细版本信息。');
      return warn(`暴露了技术栈信息：${leaks.join('；')}。`, {
        fix: snippet('# Nginx\nserver_tokens off;\n# PHP\n# expose_php = Off'),
      });
    },
  },
  {
    id: 'security-txt',
    dimension: 'security',
    severity: 'minor',
    weight: 0.4,
    title: '提供 security.txt 漏洞报告渠道',
    description: 'security.txt 让安全研究员知道如何负责任地报告漏洞，是企业站点逐渐普及的规范。',
    check: ({ aux }) => {
      if (aux?.securityTxt) return pass(`security.txt 已配置：${cut(aux.securityTxt, 60)}`);
      return info('未提供 /.well-known/security.txt（可选）。');
    },
  },
];
