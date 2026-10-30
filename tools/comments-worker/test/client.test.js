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

function page(t, request, savedKeys, github = () => Response.json({ comments: [], next_cursor: null }), auth) {
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
    if (parsed.pathname.startsWith('/github-comments')) return Promise.resolve(github(parsed, options));
    const data = options.body ? JSON.parse(options.body) : undefined;
    return request(parsed.pathname + parsed.search, options.method, data);
  };
  if (savedKeys) window.localStorage.setItem('blog-comment-delete-keys:https://comments.example.test', savedKeys);
  if (auth) {
    window.localStorage.setItem('giscus-session', JSON.stringify(auth.session));
    window.document.querySelector('.anonymous-comments').dataset.githubViewer = auth.viewer;
  }
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

test('the existing giscus login enables deletion of own comments and replies without a second login', async (t) => {
  const { request } = setup(t);
  let githubRows = [
    githubComment({ id: 'DC_own_123' }),
    githubComment({ id: 'DC_other_123', author: { name: 'another-user' }, reply_count: 1,
      replies: [githubComment({ id: 'DC_reply_123', body_html: '<p>my reply</p>' })] })
  ];
  const deletes = [];
  const github = (url, options) => {
    if (options.method === 'DELETE') {
      deletes.push({ url, options, data: JSON.parse(options.body) });
      const id = decodeURIComponent(url.pathname.split('/').at(-1));
      githubRows = githubRows.filter((item) => item.id !== id);
      githubRows.forEach((item) => { item.replies = item.replies.filter((reply) => reply.id !== id); item.reply_count = item.replies.length; });
      return Response.json({ retained: false });
    }
    return Response.json({ comments: githubRows, next_cursor: null });
  };
  const window = page(t, request, null, github, { session: 'existing-giscus-session', viewer: 'Minhye0714' });
  const document = window.document;
  await until(() => rows(document).length === 2 && idle(document));
  assert.equal(document.querySelectorAll('.github-comment-delete').length, 2);
  assert.equal(document.querySelector('[data-comment-id="github:DC_other_123"] > header .github-comment-delete'), null);
  assert.equal(document.querySelector('.github-comment-login-help').hidden, true);
  document.querySelector('[data-comment-id="github:DC_own_123"] > header .github-comment-delete').click();
  await until(() => rows(document).length === 1 && idle(document));
  assert.deepEqual(deletes[0].data, { post: POST, session: 'existing-giscus-session' });
  assert.equal(deletes[0].options.credentials, 'omit');
  document.querySelector('.comment-reply .github-comment-delete').click();
  await until(() => !document.querySelector('.comment-reply') && idle(document));
  assert.equal(deletes.length, 2);
  await new Promise((resolve) => setTimeout(resolve, 300));
  await until(() => idle(document));
  assert.equal(document.querySelectorAll('.github-comment-delete').length, 0);
  assert.equal(rows(document).length, 1);
});

test('logging in and out updates GitHub delete buttons while anonymous delete rights remain available', async (t) => {
  const { request } = setup(t);
  const input = draft();
  await request('/comments', 'POST', input);
  const window = page(t, request, JSON.stringify({ [input.id]: input.delete_token }), () => Response.json({ comments: [githubComment()], next_cursor: null }));
  const document = window.document;
  await until(() => rows(document).length === 2 && idle(document));
  const root = document.querySelector('.anonymous-comments');
  assert.equal(document.querySelector('.github-comment-delete'), null);
  assert.equal(document.querySelector('.github-comment-login-help').hidden, false);
  window.localStorage.setItem('giscus-session', JSON.stringify('logged-in-session'));
  root.dataset.githubViewer = 'minhye0714';
  root.dispatchEvent(new window.CustomEvent('comments:giscus-auth'));
  assert.ok(document.querySelector('.github-comment-delete'));
  window.localStorage.removeItem('giscus-session');
  root.dataset.githubViewer = '';
  root.dispatchEvent(new window.CustomEvent('comments:giscus-auth'));
  assert.equal(document.querySelector('.github-comment-delete'), null);
  assert.ok(document.querySelector('.anonymous-comment-delete'));
});

test('canceling a GitHub deletion or a failed request keeps the comment and unsent draft', async (t) => {
  const { request } = setup(t);
  let deletes = 0;
  const github = (url, options) => {
    if (options.method === 'DELETE') { deletes++; return Response.json({ error: 'try again' }, { status: 503 }); }
    return Response.json({ comments: [githubComment()], next_cursor: null });
  };
  const window = page(t, request, null, github, { session: 'existing-session', viewer: 'minhye0714' });
  const document = window.document;
  await until(() => document.querySelector('.github-comment-delete') && idle(document));
  document.querySelector('textarea').value = 'unsent draft';
  window.confirm = () => false;
  document.querySelector('.github-comment-delete').click();
  assert.equal(deletes, 0);
  window.confirm = () => true;
  document.querySelector('.github-comment-delete').click();
  await until(() => document.querySelector('.anonymous-comment-status').classList.contains('is-error') && idle(document));
  assert.equal(deletes, 1);
  assert.equal(rows(document).length, 1);
  assert.equal(document.querySelector('textarea').value, 'unsent draft');
});

test('an expired session requests login and removes delete buttons without removing the comment', async (t) => {
  const { request } = setup(t);
  const github = (url, options) => options.method === 'DELETE'
    ? Response.json({ error: 'sign in again' }, { status: 401 })
    : Response.json({ comments: [githubComment()], next_cursor: null });
  const window = page(t, request, null, github, { session: 'expired-session', viewer: 'minhye0714' });
  const document = window.document;
  await until(() => document.querySelector('.github-comment-delete') && idle(document));
  document.querySelector('.github-comment-delete').click();
  await until(() => !document.querySelector('.github-comment-delete') && idle(document));
  assert.equal(rows(document).length, 1);
  assert.equal(document.querySelector('.github-comment-login-help').hidden, false);
});

test('own minimized comments remain deletable, while deleted placeholders have no delete button', async (t) => {
  const { request } = setup(t);
  const window = page(t, request, null, () => Response.json({ comments: [
    githubComment({ id: 'DC_minimized', hidden: true, deleted: false }),
    githubComment({ id: 'DC_deleted', hidden: true, deleted: true })
  ], next_cursor: null }), { session: 'existing-session', viewer: 'minhye0714' });
  const document = window.document;
  await until(() => rows(document).length === 2 && idle(document));
  assert.ok(document.querySelector('[data-comment-id="github:DC_minimized"] .github-comment-delete'));
  assert.equal(document.querySelector('[data-comment-id="github:DC_deleted"] .github-comment-delete'), null);
});

test('deleting a parent body preserves its replies in the shared list', async (t) => {
  const { request } = setup(t);
  const github = (url, options) => options.method === 'DELETE'
    ? Response.json({ retained: true })
    : Response.json({ comments: [githubComment({ reply_count: 1, replies: [githubComment({ id: 'DC_reply_123', author: { name: 'another-user' } })] })], next_cursor: null });
  const window = page(t, request, null, github, { session: 'existing-session', viewer: 'minhye0714' });
  const document = window.document;
  await until(() => document.querySelector('.github-comment-delete') && idle(document));
  document.querySelector('.github-comment-delete').click();
  await until(() => !document.querySelector('.github-comment-delete') && idle(document));
  assert.equal(rows(document).length, 1);
  assert.equal(document.querySelectorAll('.comment-reply').length, 1);
  assert.equal(rows(document)[0].querySelector('strong').textContent, '삭제된 사용자');
});
