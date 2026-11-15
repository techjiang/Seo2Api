/**
 * 零依赖容错 HTML 解析器。
 *
 * 设计目标（不是"完整浏览器"）：
 *  - 对畸形 HTML 绝不抛异常，尽力提取；
 *  - 有节点数与深度上限，防止恶意页面打爆内存；
 *  - 只保留 SEO 分析需要的字段，速度优先。
 */

const VOID = new Set([
  'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr','basefont','frame','isindex',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'noscript', 'iframe']);
// 这些标签隐式结束"纯文本块"父节点，不必严格找闭合标签
const AUTO_CLOSE_P = new Set([
  'p','div','section','article','header','footer','main','aside','nav','ul','ol','table','form','h1','h2','h3','h4','h5','h6','blockquote','pre','hr','address','figure',
]);

const MAX_NODES = 60_000;
const MAX_DEPTH = 120;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™',
  hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  middot: '·', bull: '•', times: '×', divide: '÷', deg: '°', euro: '€', pound: '£', yen: '¥', cent: '¢',
  sect: '§', para: '¶', dagger: '†', plusmn: '±', frac12: '½', frac14: '¼', frac34: '¾', sup2: '²', sup3: '³',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', shy: '\u00ad', ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009', zwnj: '\u200c', zwj: '\u200d', lrm: '\u200e', rlm: '\u200f',
};

export function decodeEntities(str) {
  if (!str || str.indexOf('&') === -1) return str || '';
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return m;
      // 排除代理区
      if (code >= 0xd800 && code <= 0xdfff) return '\ufffd';
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    const hit = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
    return hit === undefined ? m : hit;
  });
}

function createNode(tag, attrs, parent) {
  return {
    tag,
    attrs,
    parent,
    children: [],
    text: '',
    depth: parent ? parent.depth + 1 : 0,
    order: 0,
  };
}

/** 解析属性串 → 对象（小写键，保留首值） */
function parseAttrs(raw) {
  const attrs = Object.create(null);
  if (!raw) return attrs;
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    if (name in attrs) continue;
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    attrs[name] = decodeEntities(val);
  }
  return attrs;
}

export class Document {
  constructor(html, { baseUrl = '' } = {}) {
    this.html = html || '';
    this.baseUrl = baseUrl;
    this.root = createNode('#document', Object.create(null), null);
    this.nodes = 0;
    this.truncated = false;
    this.doctype = null;
    this._parse();
  }

  _parse() {
    const src = this.html;
    const len = src.length;
    const root = this.root;
    const stack = [root];
    let i = 0;
    let order = 0;

    const current = () => stack[stack.length - 1];

    const pushText = (raw) => {
      if (!raw) return;
      const parent = current();
      const text = decodeEntities(raw);
      parent.text += text;
      parent.children.push({ tag: '#text', attrs: EMPTY_ATTRS, parent, children: [], text, depth: parent.depth + 1, order: order++ });
    };

    while (i < len) {
      const lt = src.indexOf('<', i);
      if (lt === -1) {
        pushText(src.slice(i));
        break;
      }
      if (lt > i) pushText(src.slice(i, lt));

      // 注释 / CDATA / doctype
      if (src.startsWith('<!--', lt)) {
        const end = src.indexOf('-->', lt + 4);
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (src.startsWith('<![CDATA[', lt)) {
        const end = src.indexOf(']]>', lt + 9);
        pushText(src.slice(lt + 9, end === -1 ? len : end));
        i = end === -1 ? len : end + 3;
        continue;
      }
      if (src.startsWith('<!', lt)) {
        const end = src.indexOf('>', lt + 2);
        if (!this.doctype && /^<!doctype/i.test(src.slice(lt, lt + 9))) {
          this.doctype = src.slice(lt + 9, end === -1 ? len : end).trim().toLowerCase() || 'html';
        }
        i = end === -1 ? len : end + 1;
        continue;
      }
      if (src.startsWith('<?', lt)) {
        const end = src.indexOf('>', lt + 2);
        i = end === -1 ? len : end + 1;
        continue;
      }

      // 结束标签
      if (src[lt + 1] === '/') {
        const gt = src.indexOf('>', lt + 2);
        if (gt === -1) { i = len; break; }
        const name = src.slice(lt + 2, gt).trim().split(/\s/)[0].toLowerCase();
        i = gt + 1;
        if (!name) continue;
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === name) {
            stack.length = s;
            break;
          }
        }
        continue;
      }

      // 开始标签
      let j = lt + 1;
      while (j < len && /[a-zA-Z0-9:_-]/.test(src[j])) j++;
      const tag = src.slice(lt + 1, j).toLowerCase();
      if (!tag) { pushText('<'); i = lt + 1; continue; }

      // 找标签结尾，跳过引号内的 '>'
      let k = j;
      let quote = null;
      while (k < len) {
        const ch = src[k];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
        } else if (ch === '>') {
          break;
        }
        k++;
      }
      const rawAttrs = src.slice(j, k);
      const selfClose = /\/\s*$/.test(rawAttrs);
      i = k + 1;

      if (this.nodes >= MAX_NODES) { this.truncated = true; break; }

      // 隐式闭合：<p> 里遇到块级标签时，先退出
      if (AUTO_CLOSE_P.has(tag)) {
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === 'p') { stack.length = s; break; }
          if (['div','section','article','ul','ol','table','form','main','aside','nav','blockquote'].includes(stack[s].tag)) break;
        }
      }
      if (tag === 'li') {
        for (let s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === 'li') { stack.length = s; break; }
          if (stack[s].tag === 'ul' || stack[s].tag === 'ol') break;
        }
      }

      const parent = current();
      const node = createNode(tag, parseAttrs(rawAttrs), parent);
      node.order = order++;
      this.nodes++;
      if (node.depth > MAX_DEPTH) {
        // 过深，扁平挂到当前节点但不再入栈
        parent.children.push(node);
        continue;
      }
      parent.children.push(node);

      if (VOID.has(tag) || (selfClose && !RAW_TEXT.has(tag))) continue;

      if (RAW_TEXT.has(tag)) {
        // 原始文本：一直吃到对应结束标签
        const closeRe = new RegExp(`</${tag}\\s*>`, 'i');
        const rest = src.slice(i);
        const m = closeRe.exec(rest);
        const inner = m ? rest.slice(0, m.index) : rest;
        node.text = tag === 'script' || tag === 'style' ? inner : decodeEntities(inner);
        if (inner) {
          node.children.push({ tag: '#text', attrs: EMPTY_ATTRS, parent: node, children: [], text: node.text, depth: node.depth + 1, order: order++ });
        }
        i = m ? i + m.index + m[0].length : len;
        continue;
      }
      stack.push(node);
    }
  }

  /** 深度优先遍历所有元素 */
  *walk(predicate = null) {
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop();
      if (node.tag !== '#text' && node !== this.root) {
        if (!predicate || predicate(node)) yield node;
      }
      for (let c = node.children.length - 1; c >= 0; c--) stack.push(node.children[c]);
    }
  }

  /** 所有指定标签 */
  all(tag) {
    const out = [];
    for (const n of this.walk((x) => x.tag === tag)) out.push(n);
    return out;
  }

  first(tag) {
    for (const n of this.walk((x) => x.tag === tag)) return n;
    return null;
  }

  /** 按 class/id 粗查（够用即可，不做完整选择器引擎） */
  byClass(cls) {
    const out = [];
    for (const n of this.walk()) {
      const c = n.attrs.class;
      if (c && c.split(/\s+/).includes(cls)) out.push(n);
    }
    return out;
  }

  meta() {
    const out = [];
    for (const n of this.all('meta')) out.push(n.attrs);
    return out;
  }

  title() {
    const t = this.first('title');
    return t ? decodeEntities(t.text).replace(/\s+/g, ' ').trim() : '';
  }

  /** 可见文本（去掉 script/style/noscript/svg 与注释），保留段落分隔 */
  visibleText({ maxLength = 2_000_000 } = {}) {
    const parts = [];
    let size = 0;
    const skip = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'head', 'iframe', 'object']);
    const collect = (node, inSkipped) => {
      for (const child of node.children) {
        if (size > maxLength) return;
        if (child.tag === '#text') {
          if (!inSkipped && child.text) {
            parts.push(child.text);
            size += child.text.length;
          }
          continue;
        }
        collect(child, inSkipped || skip.has(child.tag));
        if (size > maxLength) return;
        if (!inSkipped && /^(p|div|section|article|li|br|h[1-6]|tr|td|th|blockquote|pre)$/.test(child.tag)) parts.push('\n');
      }
    };
    collect(this.root, false);
    return parts.join(' ').replace(/[ \t\u00a0]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
  }
}

const EMPTY_ATTRS = Object.freeze(Object.create(null));

export function parseHtml(html, opts) {
  return new Document(html, opts);
}

/** 中英文混合的"字数"：中文按 1 字计，英文按分词计 */
export function countWords(text) {
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = text
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .split(/[^\p{L}\p{N}'’-]+/u)
    .filter(Boolean).length;
  return cjk + latin;
}

export function countSentences(text) {
  if (!text) return 0;
  const parts = text.split(/[.!?…。！？\n]+/).map((s) => s.trim()).filter((s) => s.length > 1);
  return parts.length;
}
