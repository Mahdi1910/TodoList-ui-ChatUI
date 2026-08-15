import { createLifecycleScope } from '../../shell/js/lifecycle-scope.js';
import { loadTodoStyles, unloadModuleStyles } from '../../shell/js/dependency-loader.js';
import { ThemeManager } from './theme.js';

const BOOTSTRAP_MESSAGES = Object.freeze({
  MODULE_LOAD: 'A required To-Do module could not be loaded.',
  INTEGRATION: 'To-Do modules loaded, but one integration is incomplete.',
  DATABASE_OPEN: 'TodoListDB could not be opened. Existing data was not cleared.',
  DATABASE_REPAIR: 'Stored To-Do data could not be repaired safely.',
  HYDRATION: 'Stored To-Do data could not be loaded.',
  UI_INIT: 'To-Do data loaded, but the interface could not finish starting.'
});

let currentInstance = null;

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Failed to load ${url} (${response.status}).`);
  return response.text();
}

async function buildTodoDom(host) {
  const [rootMarkup, standaloneMarkup] = await Promise.all([
    fetchText(new URL('../html/todo-app.html', import.meta.url)),
    fetchText(new URL('../index.html', import.meta.url))
  ]);

  const wrapper = document.createElement('div');
  wrapper.innerHTML = rootMarkup.trim();
  const root = wrapper.firstElementChild;
  if (!root) throw new Error('To-Do module root fragment is empty.');

  const parsed = new DOMParser().parseFromString(standaloneMarkup, 'text/html');
  const sourceRoot = parsed.getElementById('app');
  if (!sourceRoot) throw new Error('Standalone To-Do markup does not contain #app.');

  [...sourceRoot.childNodes].forEach(node => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node;
      if (element.classList.contains('primary-rail') || element.classList.contains('mobile-bottom-nav')) return;
    }
    root.appendChild(node.cloneNode(true));
  });

  root.querySelectorAll('.primary-rail, .mobile-bottom-nav').forEach(node => node.remove());
  host.replaceChildren(root);
  return root;
}

function createStageRunner(shell) {
  return async function runStage(stage, work) {
    try {
      return await work();
    } catch (error) {
      const message = BOOTSTRAP_MESSAGES[stage] || 'The To-Do application could not finish starting.';
      console.error(`[Todo:${stage}] ${message}`, error);
      shell.reportFatalError?.(new Error(`${message} ${error?.message || ''}`.trim(), { cause: error }));
      throw error;
    }
  };
}

function activeEditorIds() {
  return ['add-task-modal', 'subtask-modal', 'project-modal', 'tag-modal'];
}

function hasActiveEditor() {
  return activeEditorIds().some(id => document.getElementById(id)?.classList.contains('active'));
}

function removeOwnedBodyState() {
  document.body.classList.remove('task-drag-active', 'sidebar-taxonomy-drag-active', 'modal-open');
  document.querySelectorAll('.task-drag-layer, .sidebar-taxonomy-drag-layer').forEach(node => node.remove());
  document.getElementById('storage-error-banner')?.remove();
  document.getElementById('bootstrap-error-banner')?.remove();
}

export async function mount(context = {}) {
  if (currentInstance) throw new Error('To-Do is already mounted.');
  const { host, shell = {} } = context;
  if (!host) throw new Error('To-Do mount requires a host element.');

  await loadTodoStyles();
  const root = await buildTodoDom(host);
  ThemeManager.setRoot(root);
  const lifecycle = createLifecycleScope('todo');
  const runStage = createStageRunner(shell);

  let storageErrorReporter = null;
  let appMain;
  try {
    await lifecycle.capture(async () => {
      appMain = await runStage('MODULE_LOAD', () => import('./app-main.js'));
      await appMain.startApplication({
        runStage,
        setStorageErrorReporter(reporter) { storageErrorReporter = reporter; }
      });
    });
  } catch (error) {
    await lifecycle.dispose();
    ThemeManager.clearRoot(root);
    unloadModuleStyles('todo');
    root.remove();
    throw error;
  }

  const [dataServiceModule, settingsModule, tasksModule, sidebarModule, workspaceModule, scheduleModule, subtaskModule, modalModule, stateModule] = await Promise.all([
    import('./storage/data-service.js'),
    import('./components/settings.js'),
    import('./components/tasks.js'),
    import('./components/sidebar.js'),
    import('./components/workspace-controls.js'),
    import('./components/schedule.js'),
    import('./components/subtask-editor.js'),
    import('./components/modal-focus.js'),
    import('./state.js')
  ]);

  const AppDataService = dataServiceModule.AppDataService;
  const SettingsComponent = settingsModule.SettingsComponent;
  const TasksComponent = tasksModule.TasksComponent;
  const SidebarComponent = sidebarModule.SidebarComponent;
  const WorkspaceControls = workspaceModule.WorkspaceControls;
  const ScheduleComponent = scheduleModule.ScheduleComponent;
  const SubtaskEditorComponent = subtaskModule.SubtaskEditorComponent;
  const ModalFocusManager = modalModule.ModalFocusManager;
  const AppState = stateModule.AppState;

  shell.setTitle?.('To-Do');
  shell.notifyAppearance?.({
    theme: AppState.theme || 'dark',
    accent: root.style.getPropertyValue('--accent-color') || null
  });

  let leaving = false;
  let unmounted = false;

  const instance = {
    appId: 'todo',

    async handleRoute(route) {
      if (route?.app !== 'todo') throw new Error('To-Do received a non-To-Do route.');
      shell.setTitle?.('To-Do');
    },

    async prepareDeactivate() {
      if (unmounted) return { allow: true };
      if (SettingsComponent.restoreBusy) {
        alert('Please wait for the To-Do restore to finish before switching applications.');
        return { allow: false, reason: 'restore-in-progress' };
      }
      if (hasActiveEditor()) {
        const allowed = window.confirm('Switch applications? Unsaved changes in the open To-Do editor may be discarded.');
        if (!allowed) return { allow: false, reason: 'user-cancelled' };
      }
      return { allow: true };
    },

    async beforeLeave() {
      if (leaving || unmounted) return;
      leaving = true;

      TasksComponent.cancelPendingDateOpen?.();
      TasksComponent.cancelPendingTaskDrag?.();
      TasksComponent.cancelPendingTouchDrag?.();
      TasksComponent.cancelTaskDrag?.();
      TasksComponent.stopTaskDragAutoScroll?.();

      SidebarComponent.cancelPendingTaxonomyDrag?.();
      SidebarComponent.cancelPendingTaxonomyTouch?.();
      SidebarComponent.cancelTaxonomyDrag?.();
      SidebarComponent.stopTaxonomyDragAutoScroll?.();
      SidebarComponent.closeSidebarActionMenus?.();
      SidebarComponent.closeSidebar?.();

      SubtaskEditorComponent.cancelPendingDateOpen?.();
      SubtaskEditorComponent.closeMenus?.();
      SubtaskEditorComponent.close?.();
      TasksComponent.closeAllContextMenus?.();
      TasksComponent.closeTaskActionMenu?.(false);
      WorkspaceControls.closeMenu?.();
      ScheduleComponent.close?.();

      await AppDataService.whenIdle?.();
      removeOwnedBodyState();
    },

    async unmount() {
      if (unmounted) return;
      if (!leaving) await instance.beforeLeave();
      unmounted = true;

      ModalFocusManager.destroy?.();
      await lifecycle.dispose();
      removeOwnedBodyState();

      const bridges = {
        TasksComponent,
        SidebarComponent,
        WorkspaceControls,
        ScheduleComponent,
        SubtaskEditorComponent
      };
      Object.entries(bridges).forEach(([name, value]) => {
        if (window[name] === value) {
          try { delete window[name]; }
          catch (_) { window[name] = undefined; }
        }
      });

      ThemeManager.clearRoot(root);
      root.remove();
      unloadModuleStyles('todo');
      currentInstance = null;
    },

    openSettings(trigger = null) {
      SettingsComponent.openModal?.(trigger);
    },

    getAppearance() {
      return { theme: AppState.theme || 'dark' };
    },

    get storageErrorReporter() { return storageErrorReporter; }
  };

  currentInstance = instance;
  return instance;
}
