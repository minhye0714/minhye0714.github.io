(() => {
  'use strict';

  const script = document.querySelector('script[data-pageviews]');
  if (!script || script.dataset.initialized) return;
  script.dataset.initialized = 'true';
  const endpoint = script.dataset.endpoint.replace(/\/+$/, '');
  const post = new URL(script.dataset.post, location.origin).pathname;
  const storageKey = `blog-pageview:${endpoint}:${post}`;
  const visitWindow = 30 * 60 * 1000;
  const loopback = (hostname) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  // A normal `jekyll serve` must never inflate production counts.
  const readOnlyPreview = loopback(location.hostname) && !loopback(new URL(endpoint, location.origin).hostname);

  function visitId() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved && typeof saved.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.id) &&
          saved.expires > Date.now() && saved.expires <= Date.now() + visitWindow) return saved.id;
      const id = crypto.randomUUID();
      // Save before sending: a retry after a lost response reuses the same ID.
      localStorage.setItem(storageKey, JSON.stringify({ id, expires: Date.now() + visitWindow }));
      return id;
    } catch {
      // With storage blocked, show the shared count without counting refreshes.
      return null;
    }
  }

  async function api(id) {
    const query = new URLSearchParams({ post });
    const response = await fetch(`${endpoint}/pageviews${id ? '' : `?${query}`}`, {
      method: id ? 'POST' : 'GET',
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
      headers: id ? { 'Content-Type': 'application/json' } : {},
      body: id ? JSON.stringify({ id, post }) : undefined
    });
    if (!response.ok) throw new Error('Pageview request failed');
    const result = await response.json();
    if (!Number.isSafeInteger(result.views) || result.views < 0) throw new Error('Invalid pageview count');
    return result.views;
  }

  function start() {
    const readtime = document.querySelector('article .post-meta .readtime');
    if (!readtime || document.getElementById('post-pageviews')) return;
    const counter = document.createElement('span');
    counter.id = 'post-pageviews';
    counter.className = 'post-pageviews';
    counter.title = '누적 조회수 · 같은 브라우저의 30분 내 재방문은 한 번만 집계';
    const value = document.createElement('span');
    value.setAttribute('aria-live', 'polite');
    value.textContent = '—';
    counter.append('조회수', value);
    readtime.before(counter);

    async function load() {
      const noTracking = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
      const id = !readOnlyPreview && !noTracking ? visitId() : null;
      try {
        let views;
        try { views = await api(id); } catch (error) {
          if (!id) throw error;
          // POST may have succeeded even when its response was lost. Never
          // register a second visit; fall back to a read using the same post.
          views = await api(null);
        }
        value.textContent = `${views.toLocaleString('ko-KR')}회`;
        if (readOnlyPreview) counter.title = '미리보기에서는 운영 조회수를 올리지 않습니다.';
      } catch {
        value.textContent = '—';
        counter.title = '조회수를 불러오지 못했습니다.';
      }
    }

    if (document.visibilityState === 'visible') load();
    else {
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', onVisible);
        load();
      };
      document.addEventListener('visibilitychange', onVisible);
    }
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
})();
