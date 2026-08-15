/**
 * workspace-mobile.js - Small-screen Workspace explorer drawer controls.
 */

const view = document.getElementById('workspace-view');
const explorer = document.getElementById('workspace-explorer');
const toggle = document.getElementById('workspace-toggle-explorer-btn');

function isMobile() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function setOpen(open) {
  if (!view || !toggle) return;
  const shouldOpen = !!open && isMobile();
  view.classList.toggle('workspace-explorer-open', shouldOpen);
  toggle.setAttribute('aria-expanded', String(shouldOpen));
}

toggle?.addEventListener('click', event => {
  event.stopPropagation();
  setOpen(!view?.classList.contains('workspace-explorer-open'));
});

document.addEventListener('click', event => {
  if (!isMobile() || !view?.classList.contains('workspace-explorer-open')) return;
  if (explorer?.contains(event.target) || toggle?.contains(event.target)) {
    if (event.target.closest('.workspace-tree-row') && !event.target.closest('.workspace-tree-toggle, .workspace-tree-more')) {
      setOpen(false);
    }
    return;
  }
  setOpen(false);
});

window.addEventListener('resize', () => {
  if (!isMobile()) setOpen(false);
});
