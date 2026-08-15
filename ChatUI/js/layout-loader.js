/**
 * layout-loader.js - Reusable ChatUI fragment assembly with module-relative URLs.
 */

const FRAGMENTS = Object.freeze({
  leftSidebar: '../html/left-sidebar.html',
  mainChat: '../html/main-chat.html',
  workspace: '../html/workspace.html',
  rightSidebar: '../html/right-sidebar.html',
  chatModals: '../html/chat-modals.html',
  settingsModal: '../html/settings-modal.html',
  voiceOverlay: '../html/voice-overlay.html',
  readAloudPlayer: '../html/read-aloud-player.html',
  globalUi: '../html/global-ui.html'
});

async function loadFragment(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${url.pathname}: HTTP ${response.status}`);
  return response.text();
}

export function showLayoutFailure(error, target = null) {
  console.error('ChatUI layout loading failed:', error);
  const overlay = document.createElement('div');
  overlay.className = 'startup-error-overlay';
  overlay.setAttribute('role', 'alert');
  const message = error instanceof Error ? error.message : String(error || 'Unknown layout error');
  const safeMessage = message.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  overlay.innerHTML = `<div class="startup-error-card"><h1 class="startup-error-title">ChatUI could not load its layout</h1><pre class="startup-error-details">${safeMessage}</pre><button class="startup-retry-btn" type="button">Reload ChatUI</button></div>`;
  overlay.querySelector('button')?.addEventListener('click', () => window.location.reload());
  (target || document.body).appendChild(overlay);
  return overlay;
}

export async function loadChatUILayout({ appContainer, overlayRoot } = {}) {
  if (!appContainer || !overlayRoot) throw new Error('Required ChatUI layout mount points are missing.');

  const entries = Object.entries(FRAGMENTS);
  const loaded = await Promise.all(entries.map(([, path]) => loadFragment(path)));
  const fragments = Object.fromEntries(entries.map(([name], index) => [name, loaded[index]]));

  appContainer.innerHTML = `${fragments.leftSidebar}${fragments.mainChat}${fragments.workspace}${fragments.rightSidebar}`;
  const mainContent = appContainer.querySelector('.main-content');
  if (!mainContent) throw new Error('ChatUI main content mount point is missing.');
  mainContent.insertAdjacentHTML('beforeend', fragments.readAloudPlayer);
  overlayRoot.innerHTML = `${fragments.chatModals}${fragments.settingsModal}${fragments.voiceOverlay}${fragments.globalUi}`;

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  return { appContainer, overlayRoot, mainContent };
}
