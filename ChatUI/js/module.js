import { createLifecycleScope } from '../../shell/js/lifecycle-scope.js';
import {
  ensureChatDependencies,
  loadChatStyles,
  unloadModuleStyles
} from '../../shell/js/dependency-loader.js';
import { loadChatUILayout } from './layout-loader.js';
import {
  configureChatRouter,
  resetChatRouterConfiguration
} from './router/chat-router.js';
import { state, runtime } from './state/store.js';
import { abortActiveGeneration } from './chat/generation.js';
import { cancelAudioRecording } from './composer/recorder.js';
import { stopLiveVoiceMode } from './voice/live-voice-controller.js';
import { closeVoiceMode } from './voice/voice-ui.js';
import { stopActiveReadAloud } from './voice/read-aloud.js';
import { closeWorkspaceView } from './workspace/workspace-ui.js';
import { closeActionMenu } from './ui/action-menu.js';
import { closeSettingsModal, openSettingsModal } from './settings/settings.js';

let currentInstance = null;
let dormant = null;

function createRoot() {
  const root = document.createElement('section');
  root.id = 'chatui-module-root';
  root.className = 'chatui-app';
  root.dataset.chatuiModuleRoot = '';

  const appContainer = document.createElement('div');
  appContainer.id = 'app-container';
  appContainer.className = 'app-container';

  const overlayRoot = document.createElement('div');
  overlayRoot.id = 'overlay-root';
  overlayRoot.dataset.chatuiOverlayRoot = '';

  root.append(appContainer, overlayRoot);
  return { root, appContainer, overlayRoot };
}

function backupOperationBusy() {
  const create = document.getElementById('create-full-backup-btn');
  const restore = document.getElementById('restore-full-backup-btn');
  const file = document.getElementById('restore-backup-file-input');
  return Boolean((create?.disabled && restore?.disabled) || file?.disabled);
}

function clearTransientBodyUi() {
  document.getElementById('attachment-drop-overlay')?.remove();
  document.querySelectorAll('.startup-error-overlay').forEach(node => {
    if (!node.closest('#chatui-module-root')) node.remove();
  });
}

function applyShellAppearance(shell) {
  shell.notifyAppearance?.({
    theme: state.theme || 'dark',
    accent: state.accentColor || '#10A37F'
  });
}

function createMountedInstance(record, context) {
  const { shell = {}, route } = context;
  record.shell = shell;
  record.leaving = false;
  record.unmounted = false;

  const instance = {
    appId: 'chat',

    async handleRoute(nextRoute) {
      await record.app.handleRoute(nextRoute);
      applyShellAppearance(record.shell);
    },

    async prepareDeactivate() {
      if (record.unmounted) return { allow: true };
      if (backupOperationBusy()) {
        alert('Please wait for the ChatUI backup or restore operation to finish before switching applications.');
        return { allow: false, reason: 'backup-restore-in-progress' };
      }
      if (runtime.isRecordingAudio && !runtime.isVoiceModeActive) {
        const allowed = window.confirm('Switch applications? The current unsent voice recording will be discarded.');
        if (!allowed) return { allow: false, reason: 'recording-user-cancelled' };
      }
      if (runtime.isGenerating) {
        const allowed = window.confirm('Switch applications? The current assistant generation will be stopped first.');
        if (!allowed) return { allow: false, reason: 'generation-user-cancelled' };
      }
      return { allow: true };
    },

    async beforeLeave() {
      if (record.leaving || record.unmounted) return;
      record.leaving = true;

      // No new shell navigation can mount the next module until this sequence
      // resolves. Destructive user decisions were already handled above.
      if (runtime.isGenerating) abortActiveGeneration();
      if (runtime.isRecordingAudio && !runtime.isVoiceModeActive) {
        await cancelAudioRecording({ updateButton: true });
      }

      closeVoiceMode();
      await stopLiveVoiceMode();
      await stopActiveReadAloud();
      closeWorkspaceView();
      closeActionMenu();
      closeSettingsModal();

      document.querySelectorAll('.message-context-menu.show').forEach(menu => menu.classList.remove('show'));
      document.getElementById('search-modal')?.classList.add('hidden');
      document.getElementById('model-dropdown-menu')?.classList.add('hidden');
      document.getElementById('thinking-dropdown-menu')?.classList.add('hidden');
      clearTransientBodyUi();
    },

    async unmount() {
      if (record.unmounted) return;
      if (!record.leaving) await instance.beforeLeave();
      record.unmounted = true;

      record.lifecycle.suspend();
      record.root.remove();
      unloadModuleStyles('chat');
      resetChatRouterConfiguration();
      currentInstance = null;
    },

    openSettings() {
      openSettingsModal();
    },

    getAppearance() {
      return { theme: state.theme || 'dark', accent: state.accentColor || '#10A37F' };
    }
  };

  currentInstance = instance;
  if (route) applyShellAppearance(shell);
  return instance;
}

async function firstMount(context) {
  const { host, route, shell = {} } = context;
  const lifecycle = createLifecycleScope('chat');
  const { root, appContainer, overlayRoot } = createRoot();
  host.replaceChildren(root);

  configureChatRouter({
    basePath: '/chat-ui',
    ownHistory: false,
    navigate: (path, options) => shell.navigate?.(path, options),
    setTitle: title => shell.setTitle?.(title)
  });

  try {
    await loadChatUILayout({ appContainer, overlayRoot });
    let app;
    await lifecycle.capture(async () => {
      const namespace = await import('./app.js');
      app = await namespace.startChatUI({ initialRoute: route, errorTarget: overlayRoot });
      const diagnostics = await import('./diagnostics/performance-diagnostics-ui.js');
      diagnostics.initPerformanceDiagnosticsUI?.();
    });
    dormant = { root, appContainer, overlayRoot, lifecycle, app, shell, leaving: false, unmounted: false };
    return createMountedInstance(dormant, context);
  } catch (error) {
    await lifecycle.dispose();
    root.remove();
    unloadModuleStyles('chat');
    resetChatRouterConfiguration();
    dormant = null;
    throw error;
  }
}

async function restoreDormant(context) {
  const { host, route, shell = {} } = context;
  host.replaceChildren(dormant.root);
  dormant.lifecycle.resume();
  configureChatRouter({
    basePath: '/chat-ui',
    ownHistory: false,
    navigate: (path, options) => shell.navigate?.(path, options),
    setTitle: title => shell.setTitle?.(title)
  });
  const instance = createMountedInstance(dormant, context);
  await dormant.app.handleRoute(route);
  return instance;
}

export async function mount(context = {}) {
  if (currentInstance) throw new Error('ChatUI is already mounted.');
  if (!context.host) throw new Error('ChatUI mount requires a host element.');

  await Promise.all([ensureChatDependencies(), loadChatStyles()]);
  const instance = dormant ? await restoreDormant(context) : await firstMount(context);
  context.shell?.setTitle?.(state.activeChatId
    ? `${state.chats.find(chat => chat.id === state.activeChatId)?.title || 'Chat'} — ChatUI`
    : 'ChatUI');
  return instance;
}
