import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { setup, draft, ORIGIN, POST } from '../support/memory-d1.js';

const template = readFileSync(new URL('../../../_includes/comments/anonymous.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../../assets/js/comments.js', import.meta.url), 'utf8');

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Client did not reach the expected state');
}

function page(t, request, savedKeys, github = () => Response.json({ comments: [], next_cursor: null })) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: `${ORIGIN}/posts/sad-ai-syndrome/`, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.document.body.innerHTML = template.slice(template.indexOf('<section'), template.indexOf('</template>'))
    .replace('{{ anonymous_endpoint | escape }}', 'https://comments.example.test')
    .replace('{{ page.url | escape }}', '/posts/sad-ai-syndrome/');
  window.crypto.randomUUID = () => crypto.randomUUID();
  window.AbortSignal = AbortSignal;
  window.confirm = () => true;
  window.fetch = (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/github-comments') return Promise.resolve(github(parsed, options));
    const data = options.body ? JSON.parse(options.body) : undefined;
    return request(parsed.pathname + parsed.search, options.method, data);
  };
  if (savedKeys) window.localStorage.setItem('blog-comment-delete-keys:https://comments.example.test', savedKeys);
  window.eval(script);
  return window;
}

test('a visitor can post anonymously, reload, and delete their own comment; a different browser cannot', async (t) => {
  const { request, sqlite } = setup(t);
  const window = page(t, request);
  const document = window.document;
  await until(() => document.querySelector('.comments-empty'));
  const body = document.querySelector('textarea');
  body.value = '<img src=x onerror=alert(1)>\n익명 댓글 테스트';
  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => document.querySelector('.anonymous-comment-delete') && !document.querySelector('.anonymous-comment-delete').disabled);
  assert.equal(document.querySelector('.anonymous-comment-body').textContent, '<img src=x onerror=alert(1)>\n익명 댓글 테스트');
  assert.equal(document.querySelector('.anonymous-comment-body img'), null);
  assert.equal(document.querySelector('.anonymous-comment strong').textContent, '익명');

  const savedKeys = window.localStorage.getItem('blog-comment-delete-keys:https://comments.example.test');
  const anotherBrowser = page(t, request);
  await until(() => anotherBrowser.document.querySelector('.anonymous-comment'));
  assert.equal(anotherBrowser.document.querySelector('.anonymous-comment-delete'), null);

  const reloaded = page(t, request, savedKeys);
  await until(() => reloaded.document.querySelector('.anonymous-comment-delete') && !reloaded.document.querySelector('.anonymous-comment-delete').disabled);
  reloaded.document.querySelector('.anonymous-comment-delete').click();
  await until(() => reloaded.document.querySelector('.comments-empty'));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
});

test('if browser storage is blocked, posting stops before a comment can lose its deletion key', async (t) => {
  const { request, sqlite } = setup(t);
  const window = page(t, request);
  await until(() => window.document.querySelector('.comments-empty'));
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
  window.document.querySelector('textarea').value = '삭제 권한을 저장할 수 없는 댓글';
  window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => window.document.querySelector('.anonymous-comment-status').classList.contains('is-error'));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
});

function githubComment(overrides = {}) {
  return {
    id: 'DC_test', author: { name: 'minhye0714', avatar_url: 'https://avatars.githubusercontent.com/u/1', url: 'https://github.com/minhye0714' },
    created_at: '2026-10-30T05:23:08Z', body_html: '<p>test</p>', hidden: false,
    url: 'https://github.com/minhye0714/minhye0714.github.io/discussions/1#discussioncomment-1',
    upvotes: 1, reactions: [{ content: 'HEART', count: 2 }], reply_count: 0, replies: [], ...overrides
  };
}

const rows = (document) => Array.from(document.querySelectorAll('.comment-list > article'));
const idle = (document) => document.querySelector('.comment-list').getAttribute('aria-busy') === 'false';

test('the two test comments share one list, sort together, and anonymous posting/deletion preserves GitHub comments', async (t) => {
  const { request, sqlite } = setup(t);
  const input = draft({ author: 'a', body: 'test' });
  await request('/comments', 'POST', input);
  sqlite.prepare('UPDATE comments SET created_at = ?').run(Date.parse('2026-10-30T05:23:10Z'));
  // Source namespaces prevent collisions even when two services return the same ID.
  const github = () => Response.json({ comments: [githubComment({ id: input.id })], next_cursor: null });
  const window = page(t, request, JSON.stringify({ [input.id]: input.delete_token }), github);
  const document = window.document;
  await until(() => rows(document).length === 2 && idle(document));
  assert.equal(document.querySelectorAll('.comment-list').length, 1);
  assert.deepEqual(rows(document).map((row) => row.dataset.commentId), [`github:${input.id}`, `anonymous:${input.id}`]);
  assert.deepEqual(rows(document).map((row) => row.querySelector('strong').textContent), ['minhye0714', 'a']);
  assert.equal(document.querySelector('.comment-count').textContent, '2개');
  document.querySelector('[data-order="newest"]').click();
  await until(() => idle(document));
  assert.deepEqual(rows(document).map((row) => row.querySelector('.comment-provider').textContent), ['익명', 'GitHub']);
  document.querySelector('textarea').value = '새 익명 댓글';
  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => rows(document).length === 3 && idle(document));
  assert.equal(document.querySelectorAll('.github-comment').length, 1);
  document.querySelector(`[data-comment-id="anonymous:${input.id}"] .anonymous-comment-delete`).click();
  await until(() => rows(document).length === 2 && idle(document));
  assert.equal(document.querySelectorAll('.github-comment').length, 1);
});

test('GitHub Markdown, replies and counts are rendered without executable HTML', async (t) => {
  const { request } = setup(t);
  const comment = githubComment({
    body_html: '<p>test <strong>bold</strong><a href="javascript:alert(1)" onclick="alert(1)">link</a><img src="https://example.org/a.png" onerror="alert(1)"></p><script>alert(1)</script><svg onload="alert(1)"></svg><iframe src="https://example.org"></iframe>',
    reply_count: 1,
    replies: [githubComment({ id: 'reply-1', body_html: '<p>reply</p>' })]
  });
  const window = page(t, request, null, () => Response.json({ comments: [comment], next_cursor: null }));
  const document = window.document;
  await until(() => rows(document).length === 1 && idle(document));
  assert.equal(document.querySelector('.comment-markdown strong').textContent, 'bold');
  assert.equal(document.querySelectorAll('.comment-markdown script, .comment-markdown svg, .comment-markdown iframe, [onclick], [onerror]').length, 0);
  assert.equal(document.querySelector('.comment-markdown a').hasAttribute('href'), false);
  assert.equal(document.querySelector('.comment-markdown img').getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(document.querySelector('.comment-reply .comment-markdown').textContent, 'reply');
  assert.match(document.querySelector('.comment-reactions').textContent, /↑ 1.*❤️ 2/);
  let opened = false;
  document.querySelector('.anonymous-comments').addEventListener('comments:github-thread', () => { opened = true; });
  document.querySelector('.github-comment .github-thread-open').click();
  assert.equal(opened, true);
});

test('a failed source does not hide the other source or discard previously loaded comments', async (t) => {
  const { request } = setup(t);
  await request('/comments', 'POST', draft());
  let unavailable = true;
  const github = () => unavailable
    ? Response.json({ error: 'temporarily unavailable' }, { status: 503 })
    : Response.json({ comments: [githubComment()], next_cursor: null });
  const window = page(t, request, null, github);
  const document = window.document;
  await until(() => rows(document).length === 1 && idle(document));
  assert.equal(document.querySelector('.comment-load-status').classList.contains('is-error'), true);
  unavailable = false;
  document.querySelector('.comment-refresh').click();
  await until(() => rows(document).length === 2 && idle(document));
  unavailable = true;
  document.querySelector('.comment-refresh').click();
  await until(() => idle(document));
  assert.equal(rows(document).length, 2);
  assert.equal(document.querySelector('.comment-load-status').classList.contains('is-error'), true);
});

test('pagination merges both sources across page boundaries without gaps or duplicates in either order', async (t) => {
  const { request, sqlite } = setup(t);
  const githubRows = [];
  const baseTime = Date.parse('2026-10-30T00:00:00Z');
  for (let index = 0; index < 55; index++) {
    const input = draft();
    sqlite.prepare('INSERT INTO comments VALUES (?, ?, ?, ?, ?, ?)').run(input.id, POST, 'a', 'test', baseTime + index * 2000, 'private-hash');
    githubRows.push(githubComment({ id: `gh-${index}`, created_at: new Date(baseTime + index * 2000 + 1000).toISOString() }));
  }
  const github = (url) => {
    const items = url.searchParams.get('order') === 'newest' ? [...githubRows].reverse() : githubRows;
    const offset = Number(url.searchParams.get('before') || 0);
    return Response.json({ comments: items.slice(offset, offset + 50), next_cursor: items.length > offset + 50 ? String(offset + 50) : null });
  };
  const window = page(t, request, null, github);
  const document = window.document;
  await until(() => rows(document).length === 50 && idle(document));
  const times = () => rows(document).map((row) => Date.parse(row.querySelector('time').dateTime));
  assert.deepEqual(times(), Array.from({ length: 50 }, (_, index) => baseTime + index * 1000));
  document.querySelector('.comment-more').click();
  await until(() => rows(document).length === 100 && idle(document));
  document.querySelector('.comment-more').click();
  await until(() => rows(document).length === 110 && idle(document));
  assert.equal(document.querySelector('.comment-more').hidden, true);
  assert.equal(new Set(rows(document).map((row) => row.dataset.commentId)).size, 110);
  assert.deepEqual(times(), Array.from({ length: 110 }, (_, index) => baseTime + index * 1000));
  document.querySelector('[data-order="newest"]').click();
  await until(() => rows(document).length === 50 && idle(document));
  assert.deepEqual(times(), Array.from({ length: 50 }, (_, index) => baseTime + (109 - index) * 1000));
});

test('giscus updates refresh the shared list after a new GitHub comment', async (t) => {
  const { request } = setup(t);
  const githubRows = [];
  const window = page(t, request, null, () => Response.json({ comments: githubRows, next_cursor: null }));
  const document = window.document;
  await until(() => document.querySelector('.comments-empty') && idle(document));
  githubRows.push(githubComment());
  document.querySelector('.anonymous-comments').dispatchEvent(new window.CustomEvent('comments:giscus-updated'));
  await until(() => rows(document).length === 1 && idle(document));
  assert.equal(rows(document)[0].classList.contains('github-comment'), true);
});
