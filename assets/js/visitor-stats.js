(() => {
  'use strict';

  const root = document.querySelector('[data-visitors]');
  if (!root || root.dataset.initialized) return;
  root.dataset.initialized = 'true';
  const endpoint = root.dataset.endpoint.replace(/\/+$/, '');
  const key = `blog-visitor-id:${endpoint}`;
  const loopback = (hostname) => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  const readOnlyPreview = loopback(location.hostname) && !loopback(new URL(endpoint, location.origin).hostname);
  const status = root.querySelector('.visitor-stats-status');

  function visitorId() {
    try {
      const saved = localStorage.getItem(key);
      if (saved && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved)) return saved;
      const id = crypto.randomUUID();
      // Persist before sending so navigation and lost responses cannot double-count.
      localStorage.setItem(key, id);
      return id;
    } catch { return null; }
  }

  async function api(id) {
    const response = await fetch(`${endpoint}/visitors`, {
      method: id ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000), headers: id ? { 'Content-Type': 'application/json' } : {},
      body: id ? JSON.stringify({ id }) : undefined
    });
    if (!response.ok) throw new Error('Visitor request failed');
    const counts = await response.json();
    if (!['today', 'yesterday', 'total'].every((name) => Number.isSafeInteger(counts[name]) && counts[name] >= 0)) {
      throw new Error('Invalid visitor counts');
    }
    return counts;
  }

  async function load() {
    const noTracking = navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true;
    const id = !readOnlyPreview && !noTracking ? visitorId() : null;
    root.setAttribute('aria-busy', 'true');
    try {
      let counts;
      try { counts = await api(id); } catch (error) {
        if (!id) throw error;
        // A lost POST response may already have counted. Only read on fallback.
        counts = await api(null);
      }
      for (const name of ['today', 'yesterday', 'total']) {
        root.querySelector(`[data-visitor-${name}]`).textContent = counts[name].toLocaleString('ko-KR');
      }
      if (readOnlyPreview) status.textContent = '미리보기에서는 운영 통계를 올리지 않습니다.';
    } catch {
      status.textContent = '통계를 불러오지 못했습니다.';
    } finally { root.setAttribute('aria-busy', 'false'); }
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
})();
