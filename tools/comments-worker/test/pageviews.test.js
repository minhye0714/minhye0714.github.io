import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { setup, draft, ORIGIN, POST } from '../support/memory-d1.js';

test('pageview reads do not increment; new visit IDs count once and stay separate by post', async (t) => {
  const { request } = setup(t);
  const read = () => request(`/pageviews?post=${encodeURIComponent(POST)}`);
  assert.deepEqual(await (await read()).json(), { post: POST, views: 0 });
  const input = { post: POST, id: crypto.randomUUID() };
  assert.equal((await (await request('/pageviews', 'POST', input)).json()).views, 1);
  assert.equal((await (await request('/pageviews', 'POST', input)).json()).views, 1);
  assert.equal((await (await request('/pageviews', 'POST', { ...input, id: crypto.randomUUID() })).json()).views, 2);
  assert.equal((await (await read()).json()).views, 2);
  assert.equal((await (await request('/pageviews?post=/posts/other/')).json()).views, 0);
  assert.equal((await request('/pageviews', 'POST', { ...input, post: '/posts/other/' })).status, 409);
});

test('concurrent retries of the same visit ID increment atomically only once', async (t) => {
  const { request } = setup(t);
  const input = { post: POST, id: crypto.randomUUID() };
  const responses = await Promise.all(Array.from({ length: 12 }, () => request('/pageviews', 'POST', input)));
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal((await (await request(`/pageviews?post=${POST}`)).json()).views, 1);
});

test('Korean post addresses share one canonical counter and invalid/cross-origin writes are rejected', async (t) => {
  const { request } = setup(t);
  const post = '/posts/한글-글/';
  await request('/pageviews', 'POST', { post, id: crypto.randomUUID() });
  const canonical = new URL(post, ORIGIN).pathname;
  assert.equal((await (await request(`/pageviews?post=${encodeURIComponent(canonical)}`)).json()).views, 1);
  for (const data of [{ post: '/', id: crypto.randomUUID() }, { post: POST, id: 'bad' }, { post: '/posts/../../other/', id: crypto.randomUUID() }]) {
    assert.equal((await request('/pageviews', 'POST', data)).status, 400);
  }
  const input = { post: POST, id: crypto.randomUUID() };
  assert.equal((await request('/pageviews', 'POST', input, { noOrigin: true })).status, 403);
  assert.equal((await request('/pageviews', 'POST', input, { headers: { Origin: 'https://example.org' } })).status, 403);
});

test('failed counter updates roll back the visit so a retry can still count it', async (t) => {
  const { request, sqlite } = setup(t);
  t.mock.method(console, 'error', () => {});
  sqlite.exec("CREATE TRIGGER fail_view BEFORE UPDATE ON pageviews BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  const input = { post: POST, id: crypto.randomUUID() };
  assert.equal((await request('/pageviews', 'POST', input)).status, 503);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM pageview_events').get().n, 0);
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM pageviews').get().n, 0);
  sqlite.exec('DROP TRIGGER fail_view');
  assert.equal((await (await request('/pageviews', 'POST', input)).json()).views, 1);
});

test('expired visit IDs are cleaned without losing totals and view limits do not consume comment limits', async (t) => {
  const { request, sqlite } = setup(t);
  await request('/pageviews', 'POST', { post: POST, id: crypto.randomUUID() });
  sqlite.prepare('UPDATE pageview_events SET created_at = ?').run(Date.now() - 86400001);
  await request('/pageviews', 'POST', { post: POST, id: crypto.randomUUID() });
  assert.equal(sqlite.prepare('SELECT count(*) AS n FROM pageview_events').get().n, 1);
  assert.equal((await (await request(`/pageviews?post=${POST}`)).json()).views, 2);
  for (let index = 0; index < 58; index++) {
    assert.equal((await request('/pageviews', 'POST', { post: POST, id: crypto.randomUUID() })).status, 200);
  }
  assert.equal((await request('/pageviews', 'POST', { post: POST, id: crypto.randomUUID() })).status, 429);
  assert.equal((await request('/comments', 'POST', draft())).status, 201);
});

const source = readFileSync(new URL('../../../assets/js/pageviews.js', import.meta.url), 'utf8');
const endpoint = 'https://comments.example.test';

async function until(condition) {
  for (let index = 0; index < 100; index++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Pageview client did not finish');
}

function page(t, request, options = {}) {
  const dom = new JSDOM(`<script data-pageviews data-endpoint="${endpoint}" data-post="${POST}"></script><article><div class="post-meta"><span class="readtime">1 min</span></div></article>`, {
    url: (options.origin || ORIGIN) + POST, runScripts: 'outside-only', pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  window.AbortSignal = AbortSignal;
  window.crypto.randomUUID = () => crypto.randomUUID();
  if (options.saved) for (const [key, value] of Object.entries(options.saved)) window.localStorage.setItem(key, value);
  if (options.blocked) Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  if (options.dnt) Object.defineProperty(window.navigator, 'doNotTrack', { value: '1' });
  if (options.hidden) Object.defineProperty(window.document, 'visibilityState', { configurable: true, value: 'hidden' });
  window.fetch = async (url, init) => {
    const parsed = new URL(url);
    const data = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: parsed, method: init.method, data });
    const response = await request(parsed.pathname + parsed.search, init.method, data);
    if (options.lostResponse && init.method === 'POST') throw new TypeError('response lost');
    return response;
  };
  window.eval(source);
  return { window, calls, value: () => window.document.querySelector('#post-pageviews [aria-live]')?.textContent };
}

const storage = (window) => Object.fromEntries(Array.from({ length: window.localStorage.length }, (_, index) => {
  const key = window.localStorage.key(index);
  return [key, window.localStorage.getItem(key)];
}));

test('the client shows the shared total and reloads/tabs reuse the same 30-minute visit ID', async (t) => {
  const { request } = setup(t);
  const first = page(t, request);
  await until(() => first.value() === '1회');
  const saved = storage(first.window);
  const reloaded = page(t, request, { saved });
  await until(() => reloaded.value() === '1회');
  assert.equal(first.calls[0].data.id, reloaded.calls[0].data.id);
  const visitor = page(t, request);
  await until(() => visitor.value() === '2회');
  const [key] = Object.keys(saved);
  const expired = { [key]: JSON.stringify({ ...JSON.parse(saved[key]), expires: Date.now() - 1 }) };
  const later = page(t, request, { saved: expired });
  await until(() => later.value() === '3회');
});

test('blocked storage, privacy preferences, and a localhost preview using production only read counts', async (t) => {
  const { request } = setup(t);
  for (const options of [{ blocked: true }, { dnt: true }, { origin: 'http://localhost:4000' }]) {
    const client = page(t, request, options);
    await until(() => client.value() === '0회');
    assert.deepEqual(client.calls.map((call) => call.method), ['GET']);
  }
});

test('a lost registration response falls back to a read and retains the ID for the next retry', async (t) => {
  const { request } = setup(t);
  const client = page(t, request, { lostResponse: true });
  await until(() => client.value() === '1회');
  assert.deepEqual(client.calls.map((call) => call.method), ['POST', 'GET']);
  const retry = page(t, request, { saved: storage(client.window) });
  await until(() => retry.value() === '1회');
});

test('a background page waits until visible and unavailable counts never become a fake number', async (t) => {
  const { request } = setup(t);
  const client = page(t, request, { hidden: true });
  await until(() => client.value() === '—');
  assert.equal(client.calls.length, 0);
  Object.defineProperty(client.window.document, 'visibilityState', { value: 'visible' });
  client.window.document.dispatchEvent(new client.window.Event('visibilitychange'));
  client.window.document.dispatchEvent(new client.window.Event('visibilitychange'));
  await until(() => client.value() === '1회');
  assert.equal(client.calls.length, 1);
  const unavailable = page(t, () => Response.json({ error: 'unavailable' }, { status: 503 }));
  await until(() => unavailable.window.document.querySelector('#post-pageviews')?.title === '조회수를 불러오지 못했습니다.');
  assert.equal(unavailable.value(), '—');
});
