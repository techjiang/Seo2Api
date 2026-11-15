import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, decodeEntities, countWords } from '../src/core/html.js';

test('HTML 解析器', async (t) => {
  await t.test('解析基础结构', () => {
    const d = parseHtml('<html lang="zh"><head><title>T</title></head><body><h1>Hello</h1></body></html>');
    assert.equal(d.title(), 'T');
    assert.equal(d.first('html').attrs.lang, 'zh');
    assert.equal(d.all('h1')[0].text, 'Hello');
  });

  await t.test('自闭合与空元素', () => {
    const d = parseHtml('<div><br><img src="a.png"><hr/><input type="text"></div>');
    assert.equal(d.all('img').length, 1);
    assert.equal(d.all('input').length, 1);
  });

  await t.test('script 内的 HTML 不被当作标签', () => {
    const d = parseHtml('<body><script>var s="<div>x</div>";</script><p>real</p></body>');
    assert.equal(d.all('div').length, 0);
    assert.equal(d.all('p')[0].text, 'real');
  });

  await t.test('注释被忽略', () => {
    const d = parseHtml('<body><!-- <p>hidden</p> --><p>shown</p></body>');
    assert.equal(d.all('p').length, 1);
    assert.equal(d.all('p')[0].text, 'shown');
  });

  await t.test('属性引号与无引号混用', () => {
    const d = parseHtml(`<a href="/x" title='hi there' data-k=plain class="a b">t</a>`);
    const a = d.first('a');
    assert.equal(a.attrs.href, '/x');
    assert.equal(a.attrs.title, 'hi there');
    assert.equal(a.attrs['data-k'], 'plain');
    assert.equal(a.attrs.class, 'a b');
  });

  await t.test('属性值中的 > 不截断标签', () => {
    const d = parseHtml('<div title="a>b"><p>t</p></div>');
    assert.equal(d.first('div').attrs.title, 'a>b');
    assert.equal(d.all('p').length, 1);
  });

  await t.test('可见文本排除 script/style', () => {
    const d = parseHtml('<body><style>.a{color:red}</style><script>var x=1</script><p>内容</p></body>');
    const text = d.visibleText();
    assert.ok(text.includes('内容'));
    assert.ok(!text.includes('color:red'));
    assert.ok(!text.includes('var x'));
  });

  await t.test('畸形 HTML 不抛异常', () => {
    const inputs = ['<', '<>', '<div', '<div class="', '</>', '<a href=">', '\u0000<html>', '<p><p><p>'];
    for (const input of inputs) {
      assert.doesNotThrow(() => parseHtml(input), `崩溃输入: ${JSON.stringify(input)}`);
    }
  });

  await t.test('嵌套深度受限', () => {
    const deep = '<div>'.repeat(2000) + 'x';
    const d = parseHtml(deep);
    assert.ok(d.nodes > 0);
    assert.ok(d.nodes <= 60001);
  });

  await t.test('超大文档会被截断而非挂死', () => {
    const huge = '<p>' + 'x'.repeat(3_000_000) + '</p>';
    const start = Date.now();
    const d = parseHtml(huge);
    assert.ok(Date.now() - start < 5000, '解析过慢');
    assert.ok(d.nodes > 0);
  });
});

test('实体解码', async (t) => {
  await t.test('常见命名实体', () => {
    assert.equal(decodeEntities('a &amp; b'), 'a & b');
    assert.equal(decodeEntities('&lt;div&gt;'), '<div>');
    assert.equal(decodeEntities('&quot;x&quot;'), '"x"');
    assert.equal(decodeEntities('&nbsp;'), '\u00a0');
    assert.equal(decodeEntities('&hellip;'), '…');
  });

  await t.test('数字实体', () => {
    assert.equal(decodeEntities('&#65;'), 'A');
    assert.equal(decodeEntities('&#x4e2d;'), '中');
  });

  await t.test('非法实体保持原样', () => {
    assert.equal(decodeEntities('&#xZZ;'), '&#xZZ;');
    assert.equal(decodeEntities('&unknownentity;'), '&unknownentity;');
  });

  await t.test('代理区不产生乱码', () => {
    const out = decodeEntities('&#xD800;');
    assert.equal(out, '\ufffd');
  });

  await t.test('无 & 时快速返回', () => {
    const s = 'x'.repeat(10000);
    assert.equal(decodeEntities(s), s);
  });
});

test('字数统计', async (t) => {
  await t.test('中文按字', () => {
    assert.equal(countWords('你好世界'), 4);
  });
  await t.test('英文按词', () => {
    assert.equal(countWords('hello world foo'), 3);
  });
  await t.test('中英混排', () => {
    assert.equal(countWords('你好 hello 世界'), 5);
  });
  await t.test('空文本', () => {
    assert.equal(countWords(''), 0);
    assert.equal(countWords(null), 0);
  });
});
