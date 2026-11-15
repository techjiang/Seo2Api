import test from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, jsonRequest } from './helpers.js';

test('鉴权模式：key', async (t) => {
  const srv = await startTestServer({ auth: { mode: 'key', adminToken: 'adm', defaultQuotaPerMin: 100 } });
  t.after(() => srv.stop());

  const admin = { authorization: 'Bearer adm' };

  await t.test('无 token 拒绝', async () => {
    const r = await jsonRequest(srv.url('/v1/reports'));
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, 'unauthorized');
  });

  await t.test('错误 token 拒绝', async () => {
    const r = await jsonRequest(srv.url('/v1/reports'), { headers: { authorization: 'Bearer nope' } });
    assert.equal(r.status, 401);
  });

  await t.test('管理员 token 放行', async () => {
    const r = await jsonRequest(srv.url('/v1/reports'), { headers: admin });
    assert.equal(r.status, 200);
  });

  await t.test('X-API-Key 头同样有效', async () => {
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: { name: 'k' } });
    const key = c.json.data.key;
    const r = await jsonRequest(srv.url('/v1/reports'), { headers: { 'x-api-key': key } });
    assert.equal(r.status, 200);
  });

  await t.test('吊销后立即失效', async () => {
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: { name: 'k2' } });
    const { key, id } = c.json.data;
    assert.equal((await jsonRequest(srv.url('/v1/reports'), { headers: { 'x-api-key': key } })).status, 200);
    await jsonRequest(srv.url(`/v1/admin/keys/${id}/revoke`), { method: 'POST', headers: admin });
    assert.equal((await jsonRequest(srv.url('/v1/reports'), { headers: { 'x-api-key': key } })).status, 401);
  });

  await t.test('普通 key 不能访问管理接口', async () => {
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: { name: 'k3' } });
    const r = await jsonRequest(srv.url('/v1/admin/keys'), { headers: { 'x-api-key': c.json.data.key } });
    assert.equal(r.status, 403);
  });

  await t.test('删除 key 后记录消失', async () => {
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: { name: 'k4' } });
    const before = await jsonRequest(srv.url('/v1/admin/keys'), { headers: admin });
    const n1 = before.json.data.items.length;
    await jsonRequest(srv.url(`/v1/admin/keys/${c.json.data.id}`), { method: 'DELETE', headers: admin });
    const after = await jsonRequest(srv.url('/v1/admin/keys'), { headers: admin });
    assert.equal(after.json.data.items.length, n1 - 1);
  });

  await t.test('创建 key 校验参数', async () => {
    const r = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: {} });
    assert.equal(r.status, 400);
  });

  await t.test('配额被限制在合理范围', async () => {
    const r = await jsonRequest(srv.url('/v1/admin/keys'), {
      method: 'POST', headers: admin, body: { name: 'big', quotaPerMin: 10 ** 9 },
    });
    assert.ok(r.json.data.quotaPerMin <= 100_000);
  });
});

test('鉴权模式：none', async (t) => {
  const srv = await startTestServer({ auth: { mode: 'none', adminToken: 'adm' } });
  t.after(() => srv.stop());

  await t.test('公开访问不需要 token', async () => {
    assert.equal((await jsonRequest(srv.url('/v1/reports'))).status, 200);
  });

  await t.test('管理接口仍需 admin token', async () => {
    assert.equal((await jsonRequest(srv.url('/v1/admin/keys'))).status, 403);
    assert.equal((await jsonRequest(srv.url('/v1/admin/keys'), { headers: { authorization: 'Bearer adm' } })).status, 200);
  });

  await t.test('错误的 admin token 不会提权', async () => {
    assert.equal((await jsonRequest(srv.url('/v1/admin/keys'), { headers: { authorization: 'Bearer wrong' } })).status, 403);
  });
});

test('限流按 key 隔离', async (t) => {
  const srv = await startTestServer({
    auth: { mode: 'key', adminToken: 'adm' },
    rateLimit: { max: 3, burst: 0, windowMs: 60_000 },
  });
  t.after(() => srv.stop());
  const admin = { authorization: 'Bearer adm' };

  await t.test('超限返回 429 且带 retry-after', async () => {
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: { name: 'q', quotaPerMin: 2 } });
    const key = c.json.data.key;
    let last;
    for (let i = 0; i < 6; i++) {
      last = await jsonRequest(srv.url('/v1/reports'), { headers: { 'x-api-key': key } });
    }
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get('retry-after')) > 0);
    assert.equal(last.json.error.code, 'rate_limited');
  });

  await t.test('另一个 key 不受影响', async () => {
    const c = await jsonRequest(srv.url('/v1/admin/keys'), { method: 'POST', headers: admin, body: { name: 'q2', quotaPerMin: 2 } });
    const r = await jsonRequest(srv.url('/v1/reports'), { headers: { 'x-api-key': c.json.data.key } });
    assert.equal(r.status, 200);
    assert.ok(Number(r.headers.get('x-ratelimit-limit')) >= 1);
  });
});

test('请求体安全', async (t) => {
  const srv = await startTestServer();
  t.after(() => srv.stop());

  await t.test('超大请求体被拒绝', async () => {
    const big = JSON.stringify({ url: 'example.com', pad: 'x'.repeat(2 * 1024 * 1024) });
    const res = await fetch(srv.url('/v1/analyze'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: big,
    });
    assert.equal(res.status, 413);
  });

  await t.test('JSON 数组而非对象被拒绝', async () => {
    const res = await fetch(srv.url('/v1/analyze'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '[1,2,3]',
    });
    assert.equal(res.status, 400);
  });

  await t.test('批量超过上限被拒绝', async () => {
    const r = await jsonRequest(srv.url('/v1/batch'), {
      method: 'POST',
      body: { urls: Array.from({ length: 50 }, (_, i) => `https://e${i}.com`) },
    });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /最多|20|100/);
  });

  await t.test('原型污染字段不生效', async () => {
    const r = await jsonRequest(srv.url('/v1/analyze'), {
      method: 'POST',
      body: JSON.parse('{"url":"example.com","__proto__":{"polluted":true},"fast":true}'),
    });
    // 只要不崩溃、不污染即可（目标抓取可能失败）
    assert.ok([200, 502, 504, 403].includes(r.status), `意外状态 ${r.status}`);
    assert.equal({}.polluted, undefined);
  });
});
