import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../../../_includes/comments/giscus.html', import.meta.url), 'utf8');
const script = source.slice(source.indexOf('<script>') + 8, source.lastIndexOf('</script>'))
  .replace(/\{\{(.*?)\}\}/g, (_, expression) => {
    if (expression.includes('relative_url')) return JSON.stringify(expression.match(/'([^']+)'/)[1]);
    const config = {
      'site.comments.giscus.theme_origin': 'https://minhye0714.github.io',
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

test('separate post reactions preserve the existing editor, login, ordering and native comment interactions', async (t) => {
  const dom = new JSDOM('<!doctype html><article><div class="content">post</div><div id="post-reactions-anchor"></div><div class="post-tail-wrapper"></div><div id="post-comments-anchor"></div></article><div id="tail-wrapper"><nav class="post-navigation"></nav><footer></footer></div><template id="anonymous-comments-template"><section class="anonymous-comments"><div class="comment-list-panel"><div class="comment-list-heading"><h3 tabindex="-1">comments</h3></div><button class="comment-refresh">refresh</button></div><div class="comment-composers"><div class="anonymous-comment-composer"></div><p class="anonymous-comment-status"></p></div></section></template>', {
    url: 'http://localhost:4000/posts/sad-ai-syndrome/', runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.Theme = { newThemeMap: (light, dark) => ({ light, dark }), resolvedTheme: 'light', eventId: 'theme:test' };
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // Chirpy compresses inline JavaScript to one line in the rendered HTML.
  window.eval(script.replace(/\s*\r?\n\s*/g, ' '));
  const section = window.document.querySelector('.post-comments');
  const reactions = window.document.querySelector('.post-reactions');
  assert.equal(reactions.previousElementSibling.className, 'content');
  assert.equal(reactions.nextElementSibling.className, 'post-tail-wrapper');
  assert.equal(section.previousElementSibling.className, 'post-tail-wrapper');
  assert.equal(section.closest('article')?.querySelector('.content')?.textContent, 'post');
  assert.equal(section.querySelector('.comment-manage-link'), null);
  assert.equal(section.querySelector('.comment-composer-heading').classList.contains('anonymous-comment-sr-only'), false);
  const shared = section.querySelector('.anonymous-comments');
  const listPanel = shared.querySelector('.comment-list-panel');
  const anonymousComposer = shared.querySelector('.anonymous-comment-composer');
  const navigation = window.document.querySelector('.post-navigation');
  assert.equal(navigation.nextElementSibling.localName, 'footer');
  assert.ok(anonymousComposer.compareDocumentPosition(navigation) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(listPanel.nextElementSibling.className, 'comment-composers');
  assert.equal(anonymousComposer.previousElementSibling.className, 'github-comments');
  assert.equal(section.querySelector('script').dataset.reactionsEnabled, '0');
  assert.equal(new URL(section.querySelector('script').dataset.theme).origin, 'https://minhye0714.github.io');
  const iframe = window.document.createElement('iframe');
  iframe.className = 'giscus-frame';
  const editorUrl = 'https://giscus.app/ko/widget?session=encrypted-test-session&repo=blog&reactionsEnabled=0';
  iframe.src = editorUrl;
  section.querySelector('.github-comments').appendChild(iframe);
  const sent = [];
  iframe.contentWindow.postMessage = (message, origin) => { sent.push({ message, origin }); };
  await new Promise((resolve) => setImmediate(resolve));
  const reactionFrame = reactions.querySelector('iframe');
  const reactionUrl = new URL(reactionFrame.src);
  assert.equal(reactionUrl.searchParams.get('session'), 'encrypted-test-session');
  assert.equal(reactionUrl.searchParams.get('repo'), 'blog');
  assert.equal(reactionUrl.searchParams.get('reactionsEnabled'), '1');
  assert.match(reactionUrl.searchParams.get('theme'), /giscus-reactions-light\.css$/);
  assert.equal(new URL(reactionUrl.searchParams.get('theme')).origin, 'https://minhye0714.github.io');
  const reactionSent = [];
  reactionFrame.contentWindow.postMessage = (message, origin) => { reactionSent.push({ message, origin }); };
  section.dispatchEvent(new window.CustomEvent('comments:ready'));
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /giscus-composer-light\.css$/);
  section.dispatchEvent(new window.CustomEvent('comments:github-thread'));
  assert.equal(shared.hidden, false);
  assert.equal(listPanel.hidden, true);
  assert.equal(anonymousComposer.hidden, true);
  assert.equal(iframe.closest('[hidden]'), null);
  assert.equal(section.querySelector('.comment-thread-return').hidden, false);
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /\/giscus-light\.css$/);
  window.Theme.resolvedTheme = 'dark';
  window.dispatchEvent(new window.MessageEvent('message', { source: window, data: { id: 'theme:test' } }));
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /\/giscus-dark\.css$/);
  assert.match(reactionSent.at(-1).message.giscus.setConfig.theme, /giscus-reactions-dark\.css$/);
  let refreshed = false;
  section.addEventListener('comments:refresh', () => { refreshed = true; });
  section.querySelector('.comment-thread-return').click();
  assert.equal(shared.hidden, false);
  assert.equal(listPanel.hidden, false);
  assert.equal(anonymousComposer.hidden, false);
  assert.equal(refreshed, true);
  assert.equal(window.document.activeElement, section.querySelector('.comment-list-heading h3'));
  assert.match(sent.at(-1).message.giscus.setConfig.theme, /giscus-composer-dark\.css$/);
  assert.equal(section.querySelectorAll('iframe').length, 1);
  assert.equal(window.document.querySelectorAll('iframe').length, 2);
  assert.equal(iframe.src, editorUrl);
  assert.ok(sent.every((item) => item.origin === 'https://giscus.app'));

  // The official loader listens to all giscus resizes; reaction resizes must not shrink the editor.
  let editorResizes = 0;
  window.addEventListener('message', (event) => {
    if (event.origin === 'https://giscus.app' && event.data?.giscus?.resizeHeight) editorResizes++;
  });
  const resize = (origin, source, resizeHeight) => window.dispatchEvent(new window.MessageEvent('message', { origin, source, data: { giscus: { resizeHeight } } }));
  resize('https://giscus.app', reactionFrame.contentWindow, 88);
  assert.equal(reactionFrame.style.height, '88px');
  assert.equal(editorResizes, 0);
  resize('https://example.org', reactionFrame.contentWindow, 900);
  assert.equal(reactionFrame.style.height, '88px');
  resize('https://giscus.app', iframe.contentWindow, 260);
  assert.equal(editorResizes, 1);

  let changes = 0;
  let authChanges = 0;
  section.addEventListener('comments:giscus-updated', () => { changes++; });
  section.addEventListener('comments:giscus-auth', () => { authChanges++; });
  const data = { giscus: { viewer: { login: 'minhye0714' }, discussion: { url: 'https://github.com/minhye0714/minhye0714.github.io/discussions/1', totalCommentCount: 1 } } };
  const send = (origin, source) => window.dispatchEvent(new window.MessageEvent('message', { origin, source, data }));
  send('https://example.org', iframe.contentWindow);
  send('https://giscus.app', window);
  assert.equal(changes, 0);
  assert.equal(authChanges, 0);
  send('https://giscus.app', iframe.contentWindow);
  send('https://giscus.app', iframe.contentWindow);
  assert.equal(changes, 1);
  assert.equal(authChanges, 1);
  assert.equal(section.dataset.githubViewer, 'minhye0714');
  window.dispatchEvent(new window.MessageEvent('message', { origin: 'https://giscus.app', source: reactionFrame.contentWindow, data: { giscus: { viewer: { login: 'outdated-viewer' } } } }));
  assert.equal(section.dataset.githubViewer, 'minhye0714');
  data.giscus.discussion.totalCommentCount = 2;
  send('https://giscus.app', iframe.contentWindow);
  assert.equal(changes, 2);
  data.giscus.discussion.reactionCount = 1;
  send('https://giscus.app', reactionFrame.contentWindow);
  assert.equal(changes, 3);
  assert.equal(section.querySelector('.comment-manage-link'), null);
  window.dispatchEvent(new window.MessageEvent('message', {
    origin: 'https://giscus.app', source: iframe.contentWindow, data: { giscus: { signOut: true } }
  }));
  assert.equal(section.dataset.githubViewer, '');
  assert.equal(authChanges, 2);
  iframe.src = 'https://giscus.app/ko/widget?repo=blog&reactionsEnabled=0';
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(new URL(reactionFrame.src).searchParams.has('session'), false);
  assert.equal(window.document.querySelectorAll('iframe').length, 2);
});
