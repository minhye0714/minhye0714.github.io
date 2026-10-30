import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, draft, POST } from '../support/memory-d1.js';

const pinDraft = (overrides = {}) => {
  const { delete_token, ...input } = draft();
  return { ...input, pin: '0042', ...overrides };
};

test('a four-digit PIN deletes a comment without a browser key; PINs and hashes remain private', async (t) => {
  const { request, sqlite } = setup(t);
  const input = pinDraft();
  const response = await request('/comments', 'POST', input);
  assert.equal(response.status, 201);
  const { comment } = await response.json();
  assert.equal(comment.delete_method, 'pin');
  const stored = sqlite.prepare('SELECT * FROM comments WHERE id = ?').get(input.id);
  assert.match(stored.delete_pin_hash, /^[a-f0-9]{64}$/);
  assert.equal(stored.delete_hash, '');
  const listing = await (await request(`/comments?post=${POST}`)).json();
  assert.deepEqual(listing.comments, [comment]);
  assert.deepEqual(Object.keys(comment).sort(), ['author', 'body', 'created_at', 'delete_method', 'id', 'post']);
  assert(!JSON.stringify(listing).includes(stored.delete_pin_hash));
  assert(!('pin' in comment));
  assert(!('delete_pin_hash' in comment));
  const second = pinDraft();
  await request('/comments', 'POST', second);
  assert.notEqual(sqlite.prepare('SELECT delete_pin_hash FROM comments WHERE id = ?').get(second.id).delete_pin_hash, stored.delete_pin_hash);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: '1234' })).status, 403);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { delete_token: stored.delete_pin_hash })).status, 400);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: input.pin }, { headers: { 'CF-Connecting-IP': '192.0.2.2' } })).status, 204);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM comments WHERE id = ?').get(input.id).n, 0);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: input.pin })).status, 404);
});

test('PIN validation preserves leading zeros and rejects malformed values even alongside a valid legacy key', async (t) => {
  const { request, sqlite } = setup(t);
  for (const pin of ['', '123', '12345', '12a4', '１２３４', 1234, null]) {
    assert.equal((await request('/comments', 'POST', draft({ pin }))).status, 400);
  }
  const input = pinDraft({ pin: '0000' });
  assert.equal((await request('/comments', 'POST', input)).status, 201);
  for (const pin of ['123', 0, null]) {
    assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin })).status, 400);
  }
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 1);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: '0000' })).status, 204);
});

test('PIN retries are idempotent and cannot change a stored comment or PIN', async (t) => {
  const { request, sqlite, env } = setup(t);
  const input = pinDraft();
  assert.equal((await request('/comments', 'POST', input)).status, 201);
  assert.equal((await request('/comments', 'POST', input)).status, 201);
  assert.equal((await request('/comments', 'POST', { ...input, pin: '9999' })).status, 409);
  assert.equal((await request('/comments', 'POST', { ...input, body: 'changed' })).status, 409);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 1);
  assert.equal(sqlite.prepare('SELECT body FROM comments').get().body, input.body);
  env.COMMENT_RATE_LIMIT_SECRET = '';
  assert.equal((await request('/comments', 'POST', pinDraft())).status, 503);
});

test('PIN attempts share one per-comment limit across IPs and POST retries, then recover after 15 minutes', async (t) => {
  const { request, sqlite } = setup(t);
  let now = Date.parse('2026-10-30T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const input = pinDraft();
  const other = pinDraft();
  await request('/comments', 'POST', input);
  await request('/comments', 'POST', other);
  for (let index = 0; index < 5; index++) {
    const options = { headers: { 'CF-Connecting-IP': `192.0.2.${index + 10}` } };
    const response = index % 2
      ? await request('/comments', 'POST', { ...input, pin: '9999' }, options)
      : await request(`/comments/${input.id}`, 'DELETE', { pin: '9999' }, options);
    assert.equal(response.status, index % 2 ? 409 : 403);
  }
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: input.pin })).status, 429);
  assert.equal((await request('/comments', 'POST', input)).status, 429);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM comments').get().n, 2);
  assert.equal((await request(`/comments/${other.id}`, 'DELETE', { pin: other.pin })).status, 204);
  now += 15 * 60000;
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: input.pin })).status, 204);
});

test('PIN writes and deletions require the allowed origin; legacy comments keep browser-key deletion', async (t) => {
  const { request } = setup(t);
  const input = pinDraft();
  assert.equal((await request('/comments', 'POST', input, { noOrigin: true })).status, 403);
  await request('/comments', 'POST', input);
  assert.equal((await request(`/comments/${input.id}`, 'DELETE', { pin: input.pin }, { headers: { Origin: 'https://example.org' } })).status, 403);
  const legacy = draft();
  await request('/comments', 'POST', legacy);
  assert.equal((await request(`/comments/${legacy.id}`, 'DELETE', { pin: input.pin })).status, 403);
  assert.equal((await request(`/comments/${legacy.id}`, 'DELETE', { delete_token: legacy.delete_token })).status, 204);
});
