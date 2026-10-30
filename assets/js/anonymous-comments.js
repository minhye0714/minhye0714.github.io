(() => {
  'use strict';

  function initialize(root) {
    const endpoint = root.dataset.endpoint.replace(/\/+$/, '');
    const post = root.dataset.post;
    const storageKey = `blog-comment-delete-keys:${endpoint}`;
    const form = root.querySelector('form');
    const author = form.elements.author;
    const body = form.elements.body;
    const counter = root.querySelector('.anonymous-comment-counter');
    const status = root.querySelector('.anonymous-comment-status');
    const list = root.querySelector('.anonymous-comment-list');
    const more = root.querySelector('.anonymous-comment-more');
    const refresh = root.querySelector('.anonymous-comment-refresh');
    const dateFormat = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
    const rendered = new Set();
    let cursor = null;
    let busy = false;
    let pending = null;

    function message(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('is-error', isError);
    }

    function setBusy(value) {
      busy = value;
      root.querySelectorAll('button').forEach((button) => { button.disabled = value; });
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
        throw new Error('댓글 삭제 권한을 저장할 수 없어요. 브라우저 저장소를 허용한 후 다시 시도해 주세요.');
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
        method,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: AbortSignal.timeout(15000),
        headers: data ? { 'Content-Type': 'application/json' } : {},
        body: data ? JSON.stringify(data) : undefined
      });
      if (response.status === 204) return null;
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || '댓글 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
        error.status = response.status;
        throw error;
      }
      return result;
    }

    function emptyState() {
      if (list.childElementCount) return;
      const empty = document.createElement('p');
      empty.className = 'anonymous-comments-empty';
      empty.textContent = '아직 익명 댓글이 없어요.';
      list.appendChild(empty);
    }

    function card(comment, prepend = false) {
      if (rendered.has(comment.id)) return;
      list.querySelector('.anonymous-comments-empty')?.remove();
      const article = document.createElement('article');
      article.className = 'anonymous-comment';
      const header = document.createElement('header');
      const name = document.createElement('strong');
      name.textContent = comment.author;
      const time = document.createElement('time');
      const date = new Date(comment.created_at);
      time.dateTime = date.toISOString();
      time.textContent = dateFormat.format(date);
      header.append(name, time);
      const token = keys()[comment.id];
      if (token) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'anonymous-comment-delete';
        remove.textContent = '삭제';
        remove.setAttribute('aria-label', '내 댓글 삭제');
        remove.addEventListener('click', async () => {
          if (busy) return;
          if (!window.confirm('이 댓글을 삭제할까요?')) return;
          setBusy(true);
          try {
            await api(`/comments/${encodeURIComponent(comment.id)}`, 'DELETE', { delete_token: token });
            article.remove();
            rendered.delete(comment.id);
            forget(comment.id);
            emptyState();
            message('댓글을 삭제했어요.');
          } catch (error) {
            message(error.message, true);
          } finally {
            setBusy(false);
          }
        });
        header.appendChild(remove);
      }
      const content = document.createElement('p');
      content.className = 'anonymous-comment-body';
      // Comments are plain text. Never interpret visitor input as HTML.
      content.textContent = comment.body;
      article.append(header, content);
      prepend ? list.prepend(article) : list.appendChild(article);
      rendered.add(comment.id);
    }

    async function load(reset = false) {
      if (busy) return;
      setBusy(true);
      message('댓글을 불러오는 중이에요.');
      try {
        const query = new URLSearchParams({ post });
        if (!reset && cursor) query.set('before', cursor);
        const result = await api(`/comments?${query}`);
        if (reset) {
          list.replaceChildren();
          rendered.clear();
        }
        result.comments.forEach((comment) => card(comment));
        cursor = result.next_cursor;
        more.hidden = !cursor;
        emptyState();
        message('');
      } catch (error) {
        message(error.message, true);
      } finally {
        setBusy(false);
      }
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
            post,
            author: nickname,
            body: text,
            website: form.elements.website.value
          };
        }
        // Save before posting so a lost network response does not lose deletion rights.
        remember(pending.id, pending.delete_token);
        const result = await api('/comments', 'POST', pending);
        card(result.comment, true);
        if (body.value.trim() === text) body.value = '';
        counter.textContent = `${body.value.length.toLocaleString('ko-KR')} / 2,000`;
        pending = null;
        message('댓글을 등록했어요.');
      } catch (error) {
        message(error.message, true);
      } finally {
        setBusy(false);
      }
    });

    more.addEventListener('click', () => load());
    refresh.addEventListener('click', () => load(true));
    load(true);
  }

  const start = () => document.querySelectorAll('.anonymous-comments[data-endpoint]').forEach(initialize);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
