import { AppState } from './state.js';
import { AppStateSync } from './state-sync.js';
import { TaxonomyOrder } from './taxonomy-order.js';
import { TaskFilter } from './task-filter.js';
import { RepeatEngine } from './repeat/repeat-engine.js';
import { ThemeManager } from './theme.js';
import { ModalFocusManager } from './components/modal-focus.js';
import { AppPersistence } from './storage/persistence.js';
import { AppDataService } from './storage/data-service.js';
import { AppBackupValidation } from './storage/backup-validation.js';
import { AppBackupService } from './storage/backup-service.js';
import { SidebarComponent } from './components/sidebar.js';
import { WorkspaceControls } from './components/workspace-controls.js';
import { TasksComponent } from './components/tasks.js';
import { ScheduleComponent } from './components/schedule.js';
import { SubtaskEditorComponent } from './components/subtask-editor.js';
import { SettingsComponent } from './components/settings.js';

function assertMethod(owner, name, label) {
  if (typeof owner?.[name] !== 'function') throw new Error(`${label}.${name} is unavailable.`);
}

function assertIntegrations() {
  if (!AppState || !AppStateSync || !TaxonomyOrder || !TaskFilter || !RepeatEngine) {
    throw new Error('State/domain integration could not be loaded.');
  }
  if (!AppPersistence || !AppDataService || !AppBackupValidation || !AppBackupService) {
    throw new Error('Storage/Backup integration could not be loaded.');
  }
  assertMethod(TasksComponent, 'render', 'TasksComponent');
  assertMethod(TasksComponent, 'renderProjectMenu', 'TasksComponent');
  assertMethod(TasksComponent, 'resolveHierarchyDrop', 'TasksComponent');
  assertMethod(SidebarComponent, 'initTaxonomyDrag', 'SidebarComponent');
  assertMethod(SidebarComponent, 'resolveTaxonomyDrop', 'SidebarComponent');
  assertMethod(ScheduleComponent, 'initRepeatEndUi', 'ScheduleComponent');
  assertMethod(ScheduleComponent, 'showRepeatValidationError', 'ScheduleComponent');
  assertMethod(AppDataService, 'whenIdle', 'AppDataService');
  assertMethod(AppDataService, 'repairRepeatState', 'AppDataService');
}

export async function startApplication({ runStage, setStorageErrorReporter }) {
  setStorageErrorReporter?.((message, error) => AppPersistence.reportError(message, error));
  await runStage('INTEGRATION', async () => {
    ThemeManager.init();
    assertIntegrations();
    ModalFocusManager.init();
  });
  await runStage('DATABASE_OPEN', () => AppPersistence.initialize());
  await runStage('HYDRATION', () => AppPersistence.hydrateState());
  await runStage('DATABASE_REPAIR', () => AppDataService.repairRepeatState());
  await runStage('UI_INIT', async () => {
    SidebarComponent.init();
    SidebarComponent.initTaxonomyDrag();
    WorkspaceControls.init();
    TasksComponent.init();
    ScheduleComponent.init();
    ScheduleComponent.initRepeatEndUi();
    SubtaskEditorComponent.init();
    SettingsComponent.init();
  });
  console.log('✅ Apple Minimalist To-Do List Application Initialized with IndexedDB persistence.');
}
