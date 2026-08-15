/**
 * layout-loader.js - Assemble static HTML fragments before application bootstrap.
 */

async function loadFragment(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  return response.text();
}

function showLayoutFailure(error) {
  console.error('ChatUI layout loading failed:', error);
  const overlay = document.createElement('div');
  overlay.className = 'startup-error-overlay';
  overlay.setAttribute('role', 'alert');
  const message = error instanceof Error ? error.message : String(error || 'Unknown layout error');
  const safeMessage = message.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  overlay.innerHTML = `<div class="startup-error-card"><h1 class="startup-error-title">ChatUI could not load its layout</h1><pre class="startup-error-details">${safeMessage}</pre><button class="startup-retry-btn" type="button">Reload ChatUI</button></div>`;
  overlay.querySelector('button')?.addEventListener('click', () => window.location.reload());
  document.body.appendChild(overlay);
}

try {
  const [leftSidebar, mainChat, workspace, rightSidebar, chatModals, settingsModal, voiceOverlay, readAloudPlayer, globalUi] = await Promise.all([
    loadFragment('/html/left-sidebar.html'),
    loadFragment('/html/main-chat.html'),
    loadFragment('/html/workspace.html'),
    loadFragment('/html/right-sidebar.html'),
    loadFragment('/html/chat-modals.html'),
    loadFragment('/html/settings-modal.html'),
    loadFragment('/html/voice-overlay.html'),
    loadFragment('/html/read-aloud-player.html'),
    loadFragment('/html/global-ui.html')
  ]);

  const appContainer = document.getElementById('app-container');
  const overlayRoot = document.getElementById('overlay-root');
  if (!appContainer || !overlayRoot) throw new Error('Required layout mount points are missing.');

  appContainer.innerHTML = `${leftSidebar}${mainChat}${workspace}${rightSidebar}`;
  const mainContent = appContainer.querySelector('.main-content');
  if (!mainContent) throw new Error('Main content mount point is missing.');
  mainContent.insertAdjacentHTML('beforeend', readAloudPlayer);
  overlayRoot.innerHTML = `${chatModals}${settingsModal}${voiceOverlay}${globalUi}`;
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  await import('./app.js');
  // TEMP_PERF_DIAGNOSTICS
  const diagnosticsUi = await import('./diagnostics/performance-diagnostics-ui.js');
  diagnosticsUi.initPerformanceDiagnosticsUI();
} catch (error) {
  showLayoutFailure(error);
}
