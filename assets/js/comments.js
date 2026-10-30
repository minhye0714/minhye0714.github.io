(() => {
  'use strict';

  const PAGE_SIZE = 50;
  const reactionLabels = { THUMBS_UP: '👍', THUMBS_DOWN: '👎', LAUGH: '😄', HOORAY: '🎉', CONFUSED: '😕', HEART: '❤️', ROCKET: '🚀', EYES: '👀' };

  function safeUrl(value, imagesOnly = false) {
    try {
      const url = new URL(value);
      return (imagesOnly ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) ? url.href : null;
    } catch {
      return null;
    }
  }

  // Rebuild GitHub's rendered Markdown with a small allowlist. Never insert API HTML into the live DOM.
  function markdown(html) {
    const template = document.createElement('template');
    template.innerHTML = typeof html === 'string' ? html : '';
    const allowed = new Set('p br strong b em i del s blockquote ul ol li pre code a img table thead tbody tr td th hr details summary kbd sup sub span div h1 h2 h3 h4 h5 h6'.split(' '));
    const blocked = new Set('script style iframe object embed svg math form input button textarea select link meta base'.split(' '));
    function copy(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
        const fragment = document.createDocumentFragment();
        node.childNodes.forEach((child) => fragment.appendChild(copy(child)));
        return fragment;
      }
      if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.localName)) return document.createDocumentFragment();
      const result = allowed.has(node.localName) ? document.createElement(node.localName) : document.createDocumentFragment();
      if (node.localName === 'a') {
        const href = safeUrl(node.getAttribute('href'));
        if (href) result.href = href;
        result.target = '_blank';
        result.rel = 'noopener noreferrer nofollow ugc';
      }
      if (node.localName === 'img') {
        const src = safeUrl(node.getAttribute('src'), true);
        if (!src) return document.createDocumentFragment();
        result.src = src;
        result.alt = node.getAttribute('alt') || '';
        result.loading = 'lazy';
        result.setAttribute('referrerpolicy', 'no-referrer');
      }
      node.childNodes.forEach((child) => result.appendChild(copy(child)));
      return result;
    }
    return copy(template.content);
  }

  function initialize(root) {
    if (root.dataset.initialized) return;
    root.dataset.initialized = 'true';
    const endpoint = root.dataset.endpoint.replace(/\/+$/, '');
    const post = root.dataset.post;
    const storageKey = `blog-comment-delete-keys:${endpoint}`;
    const form = root.querySelector('form');
    const author = form.elements.author;
    const body = form.elements.body;
    const counter = root.querySelector('.anonymous-comment-counter');
    const status = root.querySelector('.anonymous-comment-status');
    const loadStatus = root.querySelector('.comment-load-status');
    const list = root.querySelector('.comment-list');
    const count = root.querySelector('.comment-count');
    const more = root.querySelector('.comment-more');
    const refresh = root.querySelector('.comment-refresh');
    const section = root.closest('.post-comments') || root;
    const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    const comments = new Map();
    let sources;
    let order = 'oldest';
    let busy = false;
    let pending = null;
    let refreshQueued = false;
    let refreshTimer;

    function message(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('is-error', isError);
    }

    function setBusy(value) {
      busy = value;
      list.setAttribute('aria-busy', String(value));
      root.querySelectorAll('button').forEach((button) => { button.disabled = value; });
      if (!value && refreshQueued) {
        refreshQueued = false;
        queueRefresh();
      }
    }

    function keys() {
      try {
        const value = JSON.parse(localStorage.getItem(storageKey) || '{}');
        return value && !Array.isArray(value) && typeof value === 'object' ? value : {};
      } catch {
        return {};
      }
    }

    function remember(id, token) {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...keys(), [id]: token }));
      } catch {
        throw new Error('댓글 삭제 권한을 저장할 수 없어요. 브라우저 저장소를 허용한 뒤 다시 시도해 주세요.');
      }
    }

    function forget(id) {
      try {
        const saved = keys();
        delete saved[id];
        localStorage.setItem(storageKey, JSON.stringify(saved));
      } catch {
        // The comment was already deleted on the server.
      }
    }

    async function api(path, method = 'GET', data) {
      const response = await fetch(`${endpoint}${path}`, {
        method, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(15000),
        headers: data ? { 'Content-Type': 'application/json' } : {},
        body: data ? JSON.stringify(data) : undefined
      });
      if (response.status === 204) return null;
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '댓글을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return result;
    }

    function key(comment) { return `${comment.provider}:${comment.id}`; }
    function compare(left, right) {
      const difference = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      return (difference || key(left).localeCompare(key(right))) * (order === 'oldest' ? 1 : -1);
    }
    function hasMore() { return sources.some((source) => source.buffer.length || !source.done); }

    function threadButton() {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'github-thread-open';
      button.textContent = '답글·반응';
      return button;
    }

    function card(comment, reply = false) {
      const github = comment.provider === 'github';
      const article = document.createElement('article');
      article.className = `post-comment ${github ? 'github-comment' : 'anonymous-comment'}${reply ? ' comment-reply' : ''}`;
      article.dataset.commentId = key(comment);
      const header = document.createElement('header');
      const name = document.createElement('strong');
      name.textContent = github ? comment.author.name : comment.author;
      const badge = document.createElement('span');
      badge.className = 'comment-provider';
      badge.textContent = github ? 'GitHub' : '익명';
      const time = document.createElement('time');
      const date = new Date(comment.created_at);
      time.dateTime = date.toISOString();
      time.textContent = dateFormat.format(date);
      header.append(name, badge, time);
      const avatarUrl = github && safeUrl(comment.author.avatar_url, true);
      if (avatarUrl) {
        const avatar = document.createElement('img');
        avatar.className = 'comment-avatar';
        avatar.src = avatarUrl;
        avatar.alt = '';
        avatar.width = avatar.height = 28;
        avatar.loading = 'lazy';
        avatar.setAttribute('referrerpolicy', 'no-referrer');
        header.prepend(avatar);
      }
      const token = !github && keys()[comment.id];
      if (token) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'anonymous-comment-delete';
        remove.textContent = '삭제';
        remove.setAttribute('aria-label', '내 댓글 삭제');
        remove.addEventListener('click', async () => {
          if (busy || !window.confirm('이 댓글을 삭제할까요?')) return;
          setBusy(true);
          try {
            await api(`/comments/${encodeURIComponent(comment.id)}`, 'DELETE', { delete_token: token });
            comments.delete(key(comment));
            const source = sources.find((item) => item.provider === 'anonymous');
            source.buffer = source.buffer.filter((item) => item.id !== comment.id);
            forget(comment.id);
            render();
            message('댓글을 삭제했어요.');
          } catch (error) {
            message(error.message, true);
          } finally { setBusy(false); }
        });
        header.appendChild(remove);
      }
      const content = document.createElement('div');
      content.className = github ? 'comment-markdown' : 'anonymous-comment-body';
      if (github) {
        if (comment.hidden) content.textContent = '숨김 또는 삭제된 댓글이에요.';
        else content.appendChild(markdown(comment.body_html));
      } else {
        content.textContent = comment.body;
      }
      article.append(header, content);
      if (github) {
        const footer = document.createElement('div');
        footer.className = 'comment-actions';
        const reactions = document.createElement('span');
        reactions.className = 'comment-reactions';
        reactions.textContent = [
          ...(comment.upvotes ? [`↑ ${comment.upvotes}`] : []),
          ...(comment.reactions || []).filter((item) => item.count > 0 && reactionLabels[item.content])
            .map((item) => `${reactionLabels[item.content]} ${item.count}`)
        ].join('  ');
        footer.append(reactions, threadButton());
        const href = safeUrl(comment.url);
        if (href) {
          const original = document.createElement('a');
          original.href = href;
          original.textContent = '원문·수정·삭제 ↗';
          original.target = '_blank';
          original.rel = 'noopener noreferrer';
          footer.appendChild(original);
        }
        article.appendChild(footer);
        if (!reply && comment.replies?.length) {
          const replies = document.createElement('details');
          replies.className = 'comment-replies';
          const summary = document.createElement('summary');
          summary.textContent = `답글 ${comment.reply_count}개`;
          replies.appendChild(summary);
          comment.replies.forEach((item) => replies.appendChild(card({ ...item, provider: 'github' }, true)));
          article.appendChild(replies);
        }
      }
      return article;
    }

    function render() {
      list.replaceChildren(...Array.from(comments.values()).sort(compare).map((item) => card(item)));
      if (!comments.size) {
        const empty = document.createElement('p');
        empty.className = 'comments-empty';
        empty.textContent = sources.some((source) => source.error)
          ? '댓글을 모두 불러오지 못했어요. 새로고침해 주세요.' : '첫 댓글을 남겨 주세요.';
        list.appendChild(empty);
      }
      more.hidden = !hasMore();
      count.textContent = `${comments.size}개${hasMore() ? '+' : ''}`;
    }

    async function fill(source, fresh) {
      if (source.buffer.length || source.done || source.error) return;
      try {
        const query = new URLSearchParams({ post, order });
        if (source.cursor) query.set('before', source.cursor);
        if (fresh && source.provider === 'github') query.set('fresh', '1');
        const result = await api(`${source.path}?${query}`);
        if (!Array.isArray(result.comments)) throw new Error('댓글 응답을 읽을 수 없어요.');
        if (result.next_cursor && (result.next_cursor === source.cursor || !result.comments.length)) {
          throw new Error('다음 댓글을 불러오지 못했어요. 새로고침해 주세요.');
        }
        source.buffer = result.comments.map((item) => ({ ...item, provider: source.provider }));
        source.cursor = result.next_cursor;
        source.done = !source.cursor;
      } catch (error) { source.error = error; }
    }

    async function load(reset = false, fresh = false) {
      if (busy) return;
      setBusy(true);
      loadStatus.textContent = '댓글을 불러오는 중이에요.';
      try {
        if (reset) sources = [
          { provider: 'anonymous', path: '/comments', buffer: [], cursor: null, done: false },
          { provider: 'github', path: '/github-comments', buffer: [], cursor: null, done: false }
        ];
        sources.forEach((source) => { source.error = null; });
        await Promise.all(sources.map((source) => fill(source, fresh)));
        if (reset) {
          // Keep previously visible comments from a source that is temporarily unavailable.
          const available = new Set(sources.filter((source) => !source.error).map((source) => source.provider));
          comments.forEach((item, id) => { if (available.has(item.provider)) comments.delete(id); });
        }
        // Merge the next item from each source, fetching its next page as needed.
        // This keeps page boundaries chronological even if one source has many more comments.
        for (let index = 0; index < PAGE_SIZE; index++) {
          const candidates = sources.filter((source) => source.buffer.length)
            .sort((left, right) => compare(left.buffer[0], right.buffer[0]));
          if (!candidates.length) break;
          const source = candidates[0];
          const item = source.buffer.shift();
          comments.set(key(item), item);
          await fill(source, fresh);
        }
        render();
        const errors = sources.filter((source) => source.error);
        loadStatus.classList.toggle('is-error', Boolean(errors.length));
        loadStatus.textContent = errors.map((source) => `${source.provider === 'github' ? 'GitHub' : '익명'} 댓글: ${source.error.message}`).join(' ');
      } catch (error) {
        loadStatus.textContent = error.message;
        loadStatus.classList.add('is-error');
      } finally { setBusy(false); }
    }

    function queueRefresh() {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (busy) refreshQueued = true;
        else load(true, true);
      }, 250);
    }

    body.addEventListener('input', () => {
      counter.textContent = `${body.value.length.toLocaleString('ko-KR')} / 2,000`;
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy) return;
      const text = body.value.trim();
      const nickname = author.value.trim() || '익명';
      if (!text) {
        message('댓글 내용을 입력해 주세요.', true);
        body.focus();
        return;
      }
      setBusy(true);
      message('댓글을 등록하는 중이에요.');
      try {
        if (!pending || pending.body !== text || pending.author !== nickname) {
          const bytes = crypto.getRandomValues(new Uint8Array(32));
          pending = {
            id: crypto.randomUUID(),
            delete_token: Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''),
            post, author: nickname, body: text, website: form.elements.website.value
          };
        }
        // Save before posting so a lost network response does not lose deletion rights.
        remember(pending.id, pending.delete_token);
        const result = await api('/comments', 'POST', pending);
        const comment = { ...result.comment, provider: 'anonymous' };
        comments.set(key(comment), comment);
        render();
        if (body.value.trim() === text) body.value = '';
        counter.textContent = `${body.value.length.toLocaleString('ko-KR')} / 2,000`;
        pending = null;
        message('댓글을 등록했어요.');
      } catch (error) {
        message(error.message, true);
      } finally { setBusy(false); }
    });

    root.querySelectorAll('[data-order]').forEach((button) => button.addEventListener('click', () => {
      if (busy || button.dataset.order === order) return;
      order = button.dataset.order;
      root.querySelectorAll('[data-order]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      load(true);
    }));
    more.addEventListener('click', () => load());
    refresh.addEventListener('click', () => load(true, true));
    root.addEventListener('click', (event) => {
      if (event.target.closest('.github-thread-open')) {
        section.dispatchEvent(new CustomEvent('comments:github-thread'));
      }
    });
    section.addEventListener('comments:giscus-updated', queueRefresh);
    section.addEventListener('comments:refresh', queueRefresh);
    section.dispatchEvent(new CustomEvent('comments:ready'));
    load(true);
  }

  const start = () => document.querySelectorAll('.anonymous-comments[data-endpoint]').forEach(initialize);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
