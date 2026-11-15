import crypto from 'node:crypto';
import { BASE_CSS } from './theme.js';
import { HOME_CSS } from './home-css.js';
import { REPORT_CSS } from './report-css.js';

/**
 * 页面样式合并成一份 CSS 文件。
 *
 * 之前每个页面都把 CSS 内联在 <style> 里：首页 + 报告页各带 8–13KB，
 * 每次请求都重传，还让「文本/HTML 比例」这条规则永远过不了。
 * 合并成静态资源后，浏览器缓存一次就够，HTML 也回到真正可读的体积。
 */
export const APP_CSS = [BASE_CSS, HOME_CSS, REPORT_CSS].join('\n');

/** 内容指纹，用于 ?v= 缓存失效 */
export const APP_CSS_VERSION = crypto.createHash('sha256').update(APP_CSS).digest('hex').slice(0, 12);

/**
 * 首页表单脚本。外置而不是内联，一是能缓存，二是 CSP 不必为脚本开 unsafe-inline。
 */
export const HOME_JS = `(function () {
  var f = document.getElementById('f');
  if (!f) return;
  var u = document.getElementById('url');
  var go = document.getElementById('go');
  var hint = document.getElementById('hint');
  function reset() {
    go.disabled = false;
    go.textContent = '开始检测';
  }
  f.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = (u.value || '').trim();
    if (!v) return;
    go.disabled = true;
    go.textContent = '检测中…';
    hint.innerHTML = '正在抓取并分析，通常 2–8 秒…';
    fetch('/v1/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: v })
    })
      .then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (o) {
        if (o.s === 200 && o.j.ok && o.j.data.id) { window.location.href = '/report/' + o.j.data.id; return; }
        if (o.s === 401) { hint.innerHTML = '<span class="err">需要 API Token，请在<a href="/docs">文档</a>里创建，或设置 auth.mode=none。</span>'; }
        else if (o.s === 429) { hint.innerHTML = '<span class="err">请求太频繁，稍后再试。</span>'; }
        else { hint.innerHTML = '<span class="err">' + ((o.j.error && o.j.error.message) || '检测失败') + '</span>'; }
        reset();
      })
      .catch(function () {
        hint.innerHTML = '<span class="err">网络错误，请重试。</span>';
        reset();
      });
  });
})();
`;

export const APP_JS_VERSION = crypto.createHash('sha256').update(HOME_JS).digest('hex').slice(0, 12);
