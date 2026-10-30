(() => {
  'use strict';

  if (!document.getElementById('sidebar') || !window.CSS?.supports('zoom', '1')) return;
  const root = document.documentElement;
  const pointer = matchMedia('(hover: hover) and (pointer: fine)');
  const storageKey = 'blog-sidebar-size-reference';
  const density = () => window.devicePixelRatio || 1;
  const screenKey = () => `${screen.width}x${screen.height}`;
  let reference = { density: density(), screen: screenKey() };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.screen === reference.screen && Number.isFinite(saved.density) && saved.density > 0) reference = saved;
  } catch { /* A blocked store still allows compensation on this page. */ }

  function saveReference() {
    try { localStorage.setItem(storageKey, JSON.stringify(reference)); } catch { /* Optional persistence. */ }
  }

  function update() {
    // Page zoom changes DPR. Preserve the first observed size, including across
    // article navigation/reloads, without treating Windows display scaling as zoom.
    if (reference.screen !== screenKey()) {
      reference = { density: density(), screen: screenKey() };
      saveReference();
    }
    const zoom = density() / reference.density;
    const width = window.innerWidth * zoom;
    if (!pointer.matches || width < 850) {
      delete root.dataset.sidebarFixed;
      delete root.dataset.sidebarSize;
      return;
    }
    const sidebarWidth = width >= 1650 ? 340 : 300;
    root.style.setProperty('--sidebar-inverse-zoom', String(1 / zoom));
    root.style.setProperty('--sidebar-fixed-width', `${sidebarWidth}px`);
    root.style.setProperty('--sidebar-fixed-height', `${window.innerHeight * zoom}px`);
    root.style.setProperty('--sidebar-fixed-offset', `${sidebarWidth / zoom}px`);
    root.dataset.sidebarSize = width >= 1650 ? 'wide' : 'normal';
    root.dataset.sidebarFixed = '';
  }

  function watchDensity() {
    matchMedia(`(resolution: ${density()}dppx)`).addEventListener('change', () => {
      update();
      watchDensity();
    }, { once: true });
  }

  saveReference();
  update();
  watchDensity();
  window.addEventListener('resize', update, { passive: true });
  window.addEventListener('pageshow', update);
  pointer.addEventListener('change', update);
})();
