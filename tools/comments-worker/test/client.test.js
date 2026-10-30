import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { setup, ORIGIN } from '../support/memory-d1.js';

const template = readFileSync(new URL('../../../_includes/comments/anonymous.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../../../assets/js/anonymous-comments.js', import.meta.url), 'utf8');

async function until(condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Client did not reach the expected state');
}

function page(t, request, savedKeys) {
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
  await until(() => document.querySelector('.anonymous-comments-empty'));
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
  await until(() => reloaded.document.querySelector('.anonymous-comments-empty'));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
});

test('if browser storage is blocked, posting stops before a comment can lose its deletion key', async (t) => {
  const { request, sqlite } = setup(t);
  const window = page(t, request);
  await until(() => window.document.querySelector('.anonymous-comments-empty'));
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
  window.document.querySelector('textarea').value = '삭제 권한을 저장할 수 없는 댓글';
  window.document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => window.document.querySelector('.anonymous-comment-status').classList.contains('is-error'));
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM comments').get().count, 0);
});
