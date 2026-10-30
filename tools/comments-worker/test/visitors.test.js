import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { setup, draft, ORIGIN, POST } from '../support/memory-d1.js';

test('site visitors count a browser once across reloads and concurrent requests without storing its ID or IP', async (t) => {
  const { request, sqlite } = setup(t);
  const zero = await (await request('/visitors')).json();
  assert.equal(zero.today, 0);
  assert.equal(zero.yesterday, 0);
  assert.equal(zero.total, 0);
  const input = { id: crypto.randomUUID() };
  const responses = await Promise.all(Array.from({ length: 12 }, () => request('/visitors', 'POST', input)));
  assert(responses.every((response) => response.status === 200));
  const first = await (await request('/visitors')).json();
  assert.equal(first.today, 1);
  assert.equal(first.total, 1);
  await request('/visitors', 'POST', { id: crypto.randomUUID() });
  const second = await (await request('/visitors', 'POST', input)).json();
  assert.equal(second.today, 2);
  assert.equal(second.total, 2);
  const events = sqlite.prepare('SELECT * FROM visitor_events').all();
  assert.equal(events.length, 2);
  assert(events.every((row) => /^[a-f0-9]{64}$/.test(row.visitor_hash)));
  assert(!JSON.stringify(events).includes(input.id));
  assert(!JSON.stringify(events).includes('192.0.2.1'));
  assert.deepEqual(Object.keys(second).sort(), ['date', 'timezone', 'today', 'total', 'yesterday']);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM pageviews').get().n, 0);
});

test('Korean midnight starts a new daily count; total sums daily visits while old deduplication hashes expire', async (t) => {
  const { request, sqlite } = setup(t);
  let now = Date.parse('2026-10-30T14:59:59Z');
  t.mock.method(Date, 'now', () => now);
  const input = { id: crypto.randomUUID() };
  const first = await (await request('/visitors', 'POST', input)).json();
  assert.equal(first.date, '2026-10-30');
  const hash = sqlite.prepare('SELECT visitor_hash FROM visitor_events').get().visitor_hash;
  now += 2000;
  const next = await (await request('/visitors', 'POST', input)).json();
  assert.deepEqual(next, { date: '2026-10-31', timezone: 'Asia/Seoul', today: 1, yesterday: 1, total: 2 });
  assert.notEqual(sqlite.prepare('SELECT visitor_hash FROM visitor_events WHERE day = ?').get(next.date).visitor_hash, hash);
  await request('/visitors', 'POST', { id: crypto.randomUUID() });
  now = Date.parse('2026-10-31T15:00:01Z');
  const third = await (await request('/visitors', 'POST', input)).json();
  assert.deepEqual(third, { date: '2026-11-01', timezone: 'Asia/Seoul', today: 1, yesterday: 2, total: 4 });
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM visitor_events WHERE day = '2026-10-30'").get().n, 0);
  assert.equal(sqlite.prepare("SELECT visitors FROM visitor_stats WHERE day = '2026-10-30'").get().visitors, 1);
});

test('visitor writes validate IDs and origins, enforce a separate limit, and preserve comment/pageview allowances', async (t) => {
  const { request, sqlite, env } = setup(t);
  for (const id of [null, 1, '', 'bad-id']) assert.equal((await request('/visitors', 'POST', { id })).status, 400);
  assert.equal((await request('/visitors', 'POST', { id: crypto.randomUUID() }, { noOrigin: true })).status, 403);
  assert.equal((await request('/visitors', 'POST', { id: crypto.randomUUID() }, { headers: { Origin: 'https://example.org' } })).status, 403);
  for (let index = 0; index < 60; index++) assert.equal((await request('/visitors', 'POST', { id: crypto.randomUUID() })).status, 200);
  assert.equal((await request('/visitors', 'POST', { id: crypto.randomUUID() })).status, 429);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM visitor_events').get().n, 60);
  assert.equal((await request('/comments', 'POST', draft())).status, 201);
  assert.equal((await request('/pageviews', 'POST', { id: crypto.randomUUID(), post: POST })).status, 200);
  env.COMMENT_RATE_LIMIT_SECRET = '';
  assert.equal((await request('/visitors', 'POST', { id: crypto.randomUUID() })).status, 503);
});

test('failed visitor updates roll back both counters and the deduplication entry', async (t) => {
  const { request, sqlite } = setup(t);
  t.mock.method(console, 'error', () => {});
  sqlite.exec("CREATE TRIGGER fail_visit BEFORE UPDATE ON visitor_stats BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const input = { id: crypto.randomUUID() };
  assert.equal((await request('/visitors', 'POST', input)).status, 503);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM visitor_events').get().n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM visitor_stats').get().n, 0);
  sqlite.exec('DROP TRIGGER fail_visit');
  assert.equal((await (await request('/visitors', 'POST', input)).json()).total, 1);
});

const source = readFileSync(new URL('../../../assets/js/visitor-stats.js', import.meta.url), 'utf8');
const template = readFileSync(new URL('../../../_includes/visitor-stats.html', import.meta.url), 'utf8');
const endpoint = 'https://comments.example.test';
async function until(condition) {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Visitor client did not finish');
}
function page(t, request, options = {}) {
  const html = template.slice(template.indexOf('<section'), template.indexOf('</section>') + 10)
    .replace('{{ visitor_endpoint | escape }}', endpoint);
  const dom = new JSDOM(html, { url: (options.origin || ORIGIN) + (options.path || '/'), runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  const key = `blog-visitor-id:${endpoint}`;
  window.AbortSignal = AbortSignal;
  window.crypto.randomUUID = () => crypto.randomUUID();
  if (options.id) window.localStorage.setItem(key, options.id);
  if (options.blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  if (options.dnt) Object.defineProperty(window.navigator, 'doNotTrack', { value: '1' });
  if (options.gpc) Object.defineProperty(window.navigator, 'globalPrivacyControl', { value: true });
  if (options.hidden) Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'hidden' });
  window.fetch = async (url, init) => {
    calls.push(init.method);
    const response = await request(new URL(url).pathname, init.method, init.body ? JSON.parse(init.body) : undefined);
    if (options.lostResponse && init.method === 'POST') throw new TypeError('response lost');
    return response;
  };
  window.eval(source);
  return { window, calls, id: () => window.localStorage.getItem(key), value: (name) => window.document.querySelector(`[data-visitor-${name}]`).textContent };
}

test('home, article and category navigation share one visitor ID; a different browser counts separately', async (t) => {
  const { request } = setup(t);
  const home = page(t, request);
  await until(() => home.value('today') === '1');
  for (const path of [POST, '/categories/ai/']) {
    const next = page(t, request, { id: home.id(), path });
    await until(() => next.value('today') === '1');
    assert.equal(next.value('total'), '1');
  }
  const other = page(t, request);
  await until(() => other.value('today') === '2');
  assert.notEqual(home.id(), other.id());
});

test('privacy settings, blocked storage and a local preview pointing to production only read visitor counts', async (t) => {
  const { request } = setup(t);
  for (const options of [{ blocked: true }, { dnt: true }, { gpc: true }, { origin: 'http://localhost:4000' }]) {
    const client = page(t, request, options);
    await until(() => client.value('today') === '0');
    assert.deepEqual(client.calls, ['GET']);
    assert.equal(client.value('total'), '0');
  }
});

test('a lost visitor response falls back to a read and reuses the saved ID after reload', async (t) => {
  const { request } = setup(t);
  const client = page(t, request, { lostResponse: true });
  await until(() => client.value('today') === '1');
  assert.deepEqual(client.calls, ['POST', 'GET']);
  const reloaded = page(t, request, { id: client.id() });
  await until(() => reloaded.value('total') === '1');
});

test('background pages wait for visibility; unavailable visitor data keeps placeholders and a clear status', async (t) => {
  const { request } = setup(t);
  const hidden = page(t, request, { hidden: true });
  assert.equal(hidden.calls.length, 0);
  Object.defineProperty(hidden.window.document, 'visibilityState', { value: 'visible' });
  hidden.window.document.dispatchEvent(new hidden.window.Event('visibilitychange'));
  hidden.window.document.dispatchEvent(new hidden.window.Event('visibilitychange'));
  await until(() => hidden.value('today') === '1');
  assert.equal(hidden.calls.length, 1);
  const unavailable = page(t, () => Response.json({}, { status: 503 }));
  await until(() => unavailable.window.document.querySelector('.visitor-stats-status').textContent.length > 0);
  assert.equal(unavailable.value('today'), '—');
  assert.equal(unavailable.value('total'), '—');
});
