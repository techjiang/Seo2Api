/** 规则结果的构造助手，避免每条规则手写对象字面量 */

export const pass = (message, extra = {}) => ({ status: 'pass', message, ...extra });
export const warn = (message, extra = {}) => ({ status: 'warn', message, ...extra });
export const fail = (message, extra = {}) => ({ status: 'fail', message, ...extra });
export const skip = (message, extra = {}) => ({ status: 'skip', message, ...extra });
export const info = (message, extra = {}) => ({ status: 'info', message, ...extra });

const escAttr = (s) => String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const snippet = (code, lang = 'html') => ({ code: code.trim(), lang });
export const attr = escAttr;

/** 按阈值分级：越小越好 */
export const atMost = (value, good, ok) => (value <= good ? 'pass' : value <= ok ? 'warn' : 'fail');
/** 按阈值分级：越大越好 */
export const atLeast = (value, good, ok) => (value >= good ? 'pass' : value >= ok ? 'warn' : 'fail');

/** 把 'pass' | 'warn' | 'fail' 三级判定直接映射成规则结果 */
export function levelToResult(level, good, ok, bad) {
  if (level === 'pass') return pass(good);
  if (level === 'warn') return warn(ok);
  return fail(bad);
}

/** 截断长文本用于 evidence，避免报告过大 */
export const cut = (s, n = 160) => {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) + '…' : str;
};
