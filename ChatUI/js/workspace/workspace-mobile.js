/**
 * workspace-mobile.js - Small-screen Workspace explorer drawer controls.
 */

let cleanupCurrent = null;

function isMobile() {
  return window.matchMedia('(max-width: 767px)').matches;
}

export function initWorkspaceMobile() {
  cleanupCurrent?.();
  const view = document.getElementById('workspace-view');
  const explorer = document.getElementById('workspace-explorer');
  const toggle = document.getElementById('workspace-toggle-explorer-btn');

  function setOpen(open) {
    if (!view || !toggle) return;
    const shouldOpen = !!open && isMobile();
    view.classList.toggle('workspace-explorer-open', shouldOpen);
    toggle.setAttribute('aria-expanded', String(shouldOpen));
  }

  const onToggle = event => {
    event.stopPropagation();
    setOpen(!view?.classList.contains('workspace-explorer-open'));
  };
  const onDocumentClick = event => {
    if (!isMobile() || !view?.classList.contains('workspace-explorer-open')) return;
    if (explorer?.contains(event.target) || toggle?.contains(event.target)) {
      if (event.target.closest('.workspace-tree-row') && !event.target.closest('.workspace-tree-toggle, .workspace-tree-more')) setOpen(false);
      return;
    }
    setOpen(false);
  };
  const onResize = () => { if (!isMobile()) setOpen(false); };

  toggle?.addEventListener('click', onToggle);
  document.addEventListener('click', onDocumentClick);
  window.addEventListener('resize', onResize);

  cleanupCurrent = () => {
    toggle?.removeEventListener('click', onToggle);
    document.removeEventListener('click', onDocumentClick);
    window.removeEventListener('resize', onResize);
    view?.classList.remove('workspace-explorer-open');
    cleanupCurrent = null;
  };
  return cleanupCurrent;
}

export function destroyWorkspaceMobile() {
  cleanupCurrent?.();
}
