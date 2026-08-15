import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';
export const WorkspaceControls = {
  sortKey: 'custom',
  sortDirection: 'asc',
  groupKey: 'none',
  viewType: 'list',
  settingsPanelOpen: false,

  init() {
    const settings = AppState.settings || {};
    this.sortKey = this.normalizeSortKey(settings.sortKey || 'custom');
    this.sortDirection = settings.sortDirection === 'desc' ? 'desc' : 'asc';
    this.groupKey = ['none', 'priority', 'date', 'project', 'tag'].includes(settings.groupKey) ? settings.groupKey : 'none';

    this.directionBtn = document.getElementById('btn-sort-direction');
    this.menuBtn = document.getElementById('btn-workspace-menu');
    this.menu = document.getElementById('workspace-menu');
    this.settingsTrigger = document.getElementById('workspace-sort-group-trigger');
    this.settingsPanel = document.getElementById('workspace-sort-group-panel');
    if (!this.directionBtn || !this.menuBtn || !this.menu || !this.settingsTrigger || !this.settingsPanel) return;

    this.directionBtn.addEventListener('click', () => this.toggleDirection());
    this.menuBtn.addEventListener('click', e => {
      e.stopPropagation();
      this.menu.classList.contains('open') ? this.closeMenu() : this.openMenu();
    });
    this.menu.addEventListener('click', e => {
      e.stopPropagation();
      this.handleMainMenuClick(e);
    });
    this.settingsPanel.addEventListener('click', e => {
      e.stopPropagation();
      this.handleSettingsPanelClick(e);
    });
    document.addEventListener('click', () => {
      if (this.settingsPanelOpen) {
        this.closeSettingsPanel();
        return;
      }
      this.closeMenu();
    });
    document.addEventListener('keydown', e => this.handleMenuKeydown(e));
    window.addEventListener('resize', () => this.repositionSettingsPanel());
    window.visualViewport?.addEventListener('resize', () => this.repositionSettingsPanel());
    this.syncUI();
  },

  openMenu() {
    window.SidebarComponent?.closeSidebarActionMenus();
    window.TasksComponent?.closeAllContextMenus();
    window.TasksComponent?.closeTaskActionMenu(false);
    this.menu.classList.add('open');
    this.menuBtn.setAttribute('aria-expanded', 'true');
    this.syncUI();
  },

  closeMenu() {
    this.closeSettingsPanel();
    this.menu?.classList.remove('open');
    this.menuBtn?.setAttribute('aria-expanded', 'false');
  },

  toggleSettingsPanel() {
    this.settingsPanelOpen ? this.closeSettingsPanel() : this.openSettingsPanel();
  },

  openSettingsPanel() {
    if (!this.menu.classList.contains('open')) return;
    this.settingsPanelOpen = true;
    this.settingsPanel.classList.add('open');
    this.settingsPanel.setAttribute('aria-hidden', 'false');
    this.settingsTrigger.setAttribute('aria-expanded', 'true');
    this.settingsTrigger.classList.add('submenu-open');
    this.syncUI();
    this.positionSettingsPanel();
  },

  closeSettingsPanel() {
    this.settingsPanelOpen = false;
    this.settingsPanel?.classList.remove('open');
    this.settingsPanel?.setAttribute('aria-hidden', 'true');
    this.settingsTrigger?.setAttribute('aria-expanded', 'false');
    this.settingsTrigger?.classList.remove('submenu-open');
  },

  positionSettingsPanel() {
    if (!this.settingsPanelOpen) return;
    const margin = 8;
    this.settingsPanel.style.visibility = 'hidden';
    const menuRect = this.menu.getBoundingClientRect();
    const panelRect = this.settingsPanel.getBoundingClientRect();
    let left = menuRect.right - panelRect.width;
    let top = menuRect.top;
    left = Math.min(Math.max(margin, left), window.innerWidth - panelRect.width - margin);
    top = Math.min(Math.max(margin, top), window.innerHeight - panelRect.height - margin);
    this.settingsPanel.style.left = `${Math.max(margin, left)}px`;
    this.settingsPanel.style.top = `${Math.max(margin, top)}px`;
    this.settingsPanel.style.visibility = '';
  },

  repositionSettingsPanel() {
    if (this.settingsPanelOpen) this.positionSettingsPanel();
  },

  async handleMainMenuClick(e) {
    if (e.target.closest('#workspace-sort-group-trigger')) {
      this.toggleSettingsPanel();
      return;
    }
    const viewItem = e.target.closest('[data-view-type]');
    if (viewItem && !viewItem.disabled) {
      this.closeSettingsPanel();
      await this.setViewType(viewItem.dataset.viewType, { persist: true, render: true });
    }
  },

  buildCustomOrderSnapshot() {
    const roots = AppState.getRootTasks();
    const snapshot = [{
      parentTaskId: null,
      orderedIds: this.sortTasks(roots).map(task => task.id)
    }];

    roots.forEach(parent => {
      const children = AppState.getSubtasks(parent.id);
      if (!children.length) return;
      snapshot.push({
        parentTaskId: parent.id,
        orderedIds: this.sortTasks(children).map(task => task.id)
      });
    });

    return snapshot;
  },

  async handleSettingsPanelClick(e) {
    const sortItem = e.target.closest('[data-sort-key]');
    const groupItem = e.target.closest('[data-group-key]');
    if (!sortItem && !groupItem) return;
    try {
      if (sortItem) {
        const value = this.normalizeSortKey(sortItem.dataset.sortKey);
        const current = this.normalizeSortKey(this.sortKey);
        if (value === 'custom' && current !== 'custom') {
          const snapshot = this.buildCustomOrderSnapshot();
          await AppDataService.activateCustomSort(snapshot);
          this.sortKey = 'custom';
        } else if (value !== current) {
          await AppDataService.setSetting('sortKey', value);
          this.sortKey = value;
        }
      }
      if (groupItem) {
        const value = groupItem.dataset.groupKey;
        await AppDataService.setSetting('groupKey', value);
        this.groupKey = value;
      }
      this.syncUI();
      window.TasksComponent?.render();
    } catch (error) {
      AppPersistence.reportError('Could not save the Sort & Group setting.', error);
    }
  },

  handleMenuKeydown(e) {
    if (e.key !== 'Escape' || !this.menu.classList.contains('open')) return;
    e.preventDefault();
    if (this.settingsPanelOpen) {
      this.closeSettingsPanel();
      this.settingsTrigger?.focus();
      return;
    }
    this.closeMenu();
    this.menuBtn.focus();
  },

  normalizeSortKey(sortKey) {
    return sortKey === 'default' ? 'custom' : sortKey;
  },

  normalizeViewType(viewType) {
    return viewType === 'kanban' ? 'kanban' : 'list';
  },

  async setViewType(viewType, { persist = true, render = true } = {}) {
    const next = this.normalizeViewType(viewType);
    try {
      if (persist && AppState.currentFilterType === 'project') {
        await AppDataService.setEntityViewType('project', AppState.currentFilter, next);
      } else if (persist && AppState.currentFilterType === 'tag') {
        await AppDataService.setEntityViewType('tag', AppState.currentFilter, next);
      }
      this.viewType = next;
      this.syncUI();
      if (render) window.TasksComponent?.render();
      return next;
    } catch (error) {
      AppPersistence.reportError('Could not save the selected view.', error);
      return this.viewType;
    }
  },

  syncViewFromCurrentFilter() {
    let viewType = this.viewType;
    if (AppState.currentFilterType === 'project') {
      viewType = AppState.getProject(AppState.currentFilter)?.viewType || 'list';
    } else if (AppState.currentFilterType === 'tag') {
      viewType = AppState.getTag(AppState.currentFilter)?.viewType || 'list';
    }
    this.viewType = this.normalizeViewType(viewType);
    this.syncUI();
    return this.viewType;
  },

  persistViewToCurrentEntity() {
    return this.setViewType(this.viewType, { persist: true, render: false });
  },

  async toggleDirection() {
    if (this.normalizeSortKey(this.sortKey) === 'custom') return;
    const next = this.sortDirection === 'asc' ? 'desc' : 'asc';
    try {
      await AppDataService.setSetting('sortDirection', next);
      this.sortDirection = next;
      this.syncUI();
      window.TasksComponent?.render();
    } catch (error) {
      AppPersistence.reportError('Could not save sort direction.', error);
    }
  },

  syncUI() {
    this.sortKey = this.normalizeSortKey(this.sortKey);
    this.settingsPanel?.querySelectorAll('[data-sort-key]').forEach(item => {
      const selected = this.normalizeSortKey(item.dataset.sortKey) === this.sortKey;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    this.settingsPanel?.querySelectorAll('[data-group-key]').forEach(item => {
      const selected = item.dataset.groupKey === this.groupKey;
      item.classList.toggle('selected', selected);
      item.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
    this.menu?.querySelectorAll('[data-view-type]').forEach(item => {
      const selected = !item.disabled && item.dataset.viewType === this.viewType;
      item.classList.toggle('selected', selected);
      if (!item.disabled) item.setAttribute('aria-checked', selected ? 'true' : 'false');
    });

    if (this.directionBtn) {
      const custom = this.sortKey === 'custom';
      const ascending = this.sortDirection === 'asc';
      this.directionBtn.disabled = custom;
      this.directionBtn.textContent = custom ? '↕' : (ascending ? '↑' : '↓');
      this.directionBtn.title = custom
        ? 'Custom order — long-press a task to reorder'
        : (ascending ? 'Ascending — click for Descending' : 'Descending — click for Ascending');
      this.directionBtn.setAttribute('aria-label', this.directionBtn.title);
    }
  },

  sortTasks(tasks) {
    const sorted = [...tasks];
    const sortKey = this.normalizeSortKey(this.sortKey);
    const direction = this.sortDirection === 'desc' ? -1 : 1;
    if (sortKey === 'custom') return sorted;

    const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
    const priorityRank = { high: 0, medium: 1, low: 2, '': 3 };
    sorted.sort((a, b) => {
      let result = 0;
      if (sortKey === 'dueDate') {
        const aScheduled = Boolean(a.dueDate);
        const bScheduled = Boolean(b.dueDate);
        if (aScheduled !== bScheduled) return aScheduled ? -1 : 1;
        if (!aScheduled) return 0;
        result = compareText(`${a.dueDate}|${a.dueTime || ''}`, `${b.dueDate}|${b.dueTime || ''}`);
      } else if (sortKey === 'priority') {
        result = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
      } else if (sortKey === 'name') {
        result = compareText(a.title, b.title);
      } else if (sortKey === 'createdAt') {
        result = compareText(a.createdAt, b.createdAt);
      }
      return result * direction;
    });
    return sorted;
  }
};

window.WorkspaceControls = WorkspaceControls;
