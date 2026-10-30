(() => {
  'use strict';

  const areas = [...document.querySelectorAll('[data-copy-protected]')];
  if (!areas.length) return;

  function element(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function selectedContentIsProtected() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return false;
    for (let index = 0; index < selection.rangeCount; index++) {
      const range = selection.getRangeAt(index);
      if (areas.some((area) => range.intersectsNode(area))) return true;
    }
    return false;
  }

  function preventContentCopy(event) {
    const target = element(event.target);
    // Keep editing, selecting, and pasting in comment fields available.
    if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
    const copyingSelection = ['copy', 'cut'].includes(event.type) && selectedContentIsProtected();
    if (!target?.closest('[data-copy-protected]') && !copyingSelection) return;
    event.preventDefault();
    event.stopPropagation();
  }

  // Silent browser interaction restrictions, not a security boundary.
  for (const type of ['copy', 'cut', 'selectstart', 'dragstart', 'contextmenu']) {
    document.addEventListener(type, preventContentCopy, { capture: true });
  }
})();
