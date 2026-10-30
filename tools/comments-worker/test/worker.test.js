import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, ORIGIN, POST } from '../support/memory-d1.js';

test('anonymous comments persist, remain separate by post, and can be deleted with their key', async (t) => {
  const { request, sqlite } = setup(t);
  const input = draft();
  assert.deepEqual((await (await request(`/comments?post=${POST}`)).json()).comments, []);
  const created = await request('/comments', 'POST', input);
  assert.equal(created.status, 201);
  const { comment } = await created.json();
  assert.equal(comment.author, '익명');
  assert.equal(comment.body, input.body);
  assert.ok(!('delete_hash' in comment));
  assert.ok(!('delete_token' in comment));
  const stored = sqlite.prepare('SELECT delete_hash FROM comments WHERE id = ?').get(input.id);
  assert.match(stored.delete_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.delete_hash, input.delete_token);
  const listing = await (await request(`/comments?post=${POST}`)).json();
  assert.equal(listing.comments.length, 1);
  assert.ok(!JSON.stringify(listing).includes(stored.delete_hash));
  assert.equal((await (await request('/comments?post=/posts/other/')).json()).comments.length, 0);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { delete_token: input.delete_token })).status, 204);
  assert.equal((await (await request(`/comments?post=${POST}`)).json()).comments.length, 0);
});

test('knowing a comment ID does not grant deletion permission', async (t) => {
  const { request, sqlite } = setup(t);
  const input = draft();
  await request('/comments', 'POST', input);
  const response = await request(`/comments/${input.id}`, 'DELETE', { delete_token: draft().delete_token });
  assert.equal(response.status, 403);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 1);
});

test('a retried submission is idempotent and an existing ID cannot be overwritten', async (t) => {
  const { request, sqlite } = setup(t);
  const input = draft();
  assert.equal((await request('/comments', 'POST', input)).status, 201);
  assert.equal((await request('/comments', 'POST', input)).status, 201);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 1);
  const attacker = draft({ id: input.id, body: '다른 사람이 덮어쓴 댓글' });
  assert.equal((await request('/comments', 'POST', attacker)).status, 409);
  assert.equal(sqlite.prepare('SELECT body FROM comments').get().body, input.body);
});

test('cross-origin writes and requests without an Origin are rejected', async (t) => {
  const { request, sqlite } = setup(t);
  assert.equal((await request('/comments', 'POST', draft(), { headers: { Origin: 'https://example.org' } })).status, 403);
  assert.equal((await request('/comments', 'POST', draft(), { noOrigin: true })).status, 403);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
  const preflight = await request('/comments', 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.ok(preflight.headers.get('Access-Control-Allow-Methods').includes('DELETE'));
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'), null);
});

test('invalid, oversized, and honeypot submissions never reach the database', async (t) => {
  const { request, sqlite } = setup(t);
  for (const input of [draft({ body: ' ' }), draft({ body: 'x'.repeat(2001) }), draft({ author: 'x'.repeat(31) }), draft({ post: '/' }), draft({ website: 'spam' }), draft({ id: 'not-a-uuid' })]) {
    assert.equal((await request('/comments', 'POST', input)).status, 400);
  }
  assert.equal((await request('/comments', 'POST', {}, { rawBody: '{broken' })).status, 400);
  assert.equal((await request('/comments', 'POST', {}, { rawBody: 'x'.repeat(9000) })).status, 413);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
});

test('mutation rate limits are enforced and IP addresses are not stored', async (t) => {
  const { request, sqlite } = setup(t);
  const statuses = [];
  for (let index = 0; index < 30; index++) statuses.push((await request('/comments', 'POST', draft())).status);
  assert.ok(statuses.includes(429));
  const rows = sqlite.prepare('SELECT * FROM rate_limits').all();
  assert.ok(rows.every((row) => row.count <= 10));
  assert.ok(rows.every((row) => /^[a-f0-9]{64}$/.test(row.client_key)));
  assert.ok(!JSON.stringify(rows).includes('192.0.2.1'));
});

test('pagination handles equal timestamps without leaking or skipping comments', async (t) => {
  const { request, sqlite } = setup(t);
  const ids = new Set();
  for (let index = 0; index < 55; index++) {
    const input = draft();
    ids.add(input.id);
    sqlite.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?)').run(input.id, POST, '익명', String(index), 1761700000000, 'not-a-public-key');
  }
  const first = await (await request(`/comments?post=${POST}`)).json();
  assert.equal(first.comments.length, 50);
  assert.ok(first.next_cursor);
  const second = await (await request(`/comments?post=${POST}&before=${encodeURIComponent(first.next_cursor)}`)).json();
  assert.equal(second.comments.length, 5);
  assert.equal(second.next_cursor, null);
  assert.deepEqual(new Set([...first.comments, ...second.comments].map((row) => row.id)), ids);
  assert.equal((await request(`/comments?post=${POST}&before=bad`)).status, 400);
});

test('health checks require a usable database and configured rate-limit secret', async (t) => {
  const { request, env } = setup(t);
  assert.equal((await request('/health')).status, 200);
  env.COMMENT_RATE_LIMIT_SECRET = '';
  assert.equal((await request('/health')).status, 503);
  env.DB = null;
  assert.equal((await request(`/comments?post=${POST}`)).status, 503);
});
