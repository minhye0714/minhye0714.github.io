import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../_includes/comments/giscus.html', import.meta.url), 'utf8');
const script = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'))
  .replace(/\{\{(.*?)\}\}/g, (_, expression) => {
    if (expression.includes('relative_url')) return JSON.stringify(expression.match(/'([^']+)'/)[1]);
    const config = {
      'site.comments.giscus.repo': 'minhye0714/minhye0714.github.io',
      'site.comments.giscus.repo_id': 'repo-id',
      'site.comments.giscus.category': 'Announcements',
      'site.comments.giscus.category_id': 'category-id',
      'site.comments.giscus.mapping': 'pathname',
      'site.comments.giscus.strict': '1',
      'site.comments.giscus.reactions_enabled': '1',
      'site.comments.giscus.input_position': 'top',
      'site.comments.giscus.lang': 'ko'
    };
    return JSON.stringify(config[expression.trim().split(/\s/)[0]]);
  });

test('one giscus iframe switches between the composer and native interactions while hiding the shared list', async (t) => {
  const dom = new JSDOM('<!doctype html><div id="tail-wrapper"><footer></footer></div><template id="anonymous-comments-template"><section class="anonymous-comments"><div class="comment-list-heading"><h3 tabindex="-1">comments</h3></div><button class="comment-refresh">refresh</button></section></template>', {
    url: 'https://minhye0714.github.io/posts/sad-ai-syndrome/', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.Theme = { newThemeMap: (light, dark) => ({ light, dark }), resolvedTheme: 'light', eventId: 'theme:test' };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.eval(script);
  const section = window.document.querySelector('.post-comments');
  const shared = section.querySelector('.anonymous-comments');
  const iframe = window.document.createElement('iframe');
  iframe.className = 'giscus-frame';
  iframe.src = 'https://giscus.app/ko/widget';
  section.querySelector('.github-comments').appendChild(iframe);
  const sent = [];
  iframe.contentWindow.postMessage = (message, origin) => { sent.push({ message, origin }); };
  await new Promise((resolve) => setImmediate(resolve));
  section.dispatchEvent(new window.CustomEvent('comments:ready'));
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /giscus-composer-light\.css$/);
  section.dispatchEvent(new window.CustomEvent('comments:github-thread'));
  assert.equal(shared.hidden, true);
  assert.equal(section.querySelector('.comment-thread-return').hidden, false);
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /\/giscus-light\.css$/);
  window.Theme.resolvedTheme = 'dark';
  window.dispatchEvent(new window.MessageEvent('message', { source: window, data: { id: 'theme:test' } }));
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /\/giscus-dark\.css$/);
  let refreshed = false;
  section.addEventListener('comments:refresh', () => { refreshed = true; });
  section.querySelector('.comment-thread-return').click();
  assert.equal(shared.hidden, false);
  assert.equal(refreshed, true);
  assert.equal(window.document.activeElement, section.querySelector('.comment-list-heading h3'));
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /giscus-composer-dark\.css$/);
  assert.equal(section.querySelectorAll('iframe').length, 1);
  assert.equal(iframe.src, 'https://giscus.app/ko/widget');
  assert.ok(sent.every((item) => item.origin === 'https://giscus.app'));

  let changes = 0;
  section.addEventListener('comments:giscus-updated', () => { changes++; });
  const data = { giscus: { discussion: { url: 'https://github.com/minhye0714/minhye0714.github.io/discussions/1', totalCommentCount: 1 } } };
  const send = (origin, source) => window.dispatchEvent(new window.MessageEvent('message', { origin, source, data }));
  send('https://example.org', iframe.contentWindow);
  send('https://giscus.app', window);
  assert.equal(changes, 0);
  send('https://giscus.app', iframe.contentWindow);
  send('https://giscus.app', iframe.contentWindow);
  assert.equal(changes, 1);
  data.giscus.discussion.totalCommentCount = 2;
  send('https://giscus.app', iframe.contentWindow);
  assert.equal(changes, 2);
  assert.equal(section.querySelector('.comment-manage-link').href, data.giscus.discussion.url);
});
