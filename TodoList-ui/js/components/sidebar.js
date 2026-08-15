import { AppState } from '../state.js';
import { SidebarProjectConfig, SidebarProjectMethods } from './sidebar-projects.js';
import { SidebarTagConfig, SidebarTagMethods } from './sidebar-tags.js';
import { SidebarTaxonomyCore } from './sidebar-taxonomy-core.js';
import { SidebarTaxonomyDragMethods } from './sidebar-taxonomy-drag.js';
import { SidebarTaxonomyDragHierarchyMethods } from './sidebar-taxonomy-drag-hierarchy.js';
import { SidebarTaxonomyDragTouchMethods } from './sidebar-taxonomy-drag-touch.js';
import { SidebarTaxonomyDragCommitMethods } from './sidebar-taxonomy-drag-commit.js';

/**
 * Sidebar Component Handler
 * Manages drawer state, filters, counts, and accessible navigation state.
 */

const SidebarCore = {
  init() {
    this.sidebarEl = document.getElementById('secondary-sidebar');
    this.backdropEl = document.getElementById('sidebar-backdrop');
    this.toggleBtn = document.getElementById('btn-toggle-sidebar');
    this.viewTitleEl = document.getElementById('current-view-title');
    this.taxonomyConfigs = [SidebarProjectConfig, SidebarTagConfig].filter(Boolean);
    this.taxonomyConfigs.forEach(config => SidebarTaxonomyCore.initialize(this, config));
    this.bindEvents();
    this.renderProjects();
    this.renderTags();
    this.updateCounts();
  },

  bindEvents() {
    this.toggleBtn?.addEventListener('click', () => this.toggleSidebar());
    this.backdropEl?.addEventListener('click', () => this.closeSidebar());

    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.addEventListener('click', event => this.selectFilter(event.currentTarget));
    });

    this.taxonomyConfigs.forEach(config => SidebarTaxonomyCore.bindEvents(this, config));

    document.addEventListener('click', () => {
      this.taxonomyConfigs.forEach(config => SidebarTaxonomyCore.closeIconPicker(this, config));
      this.closeSidebarActionMenus();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.closeSidebarActionMenus();
    });
  },

  selectFilter(targetBtn) {
    this.closeSidebarActionMenus();
    document.querySelectorAll('.sidebar-nav-item').forEach(item => item.classList.remove('active'));
    targetBtn.classList.add('active');

    if (targetBtn.dataset.filter) {
      AppState.currentFilter = targetBtn.dataset.filter;
      AppState.currentFilterType = 'smart';
    } else if (targetBtn.dataset.project) {
      AppState.currentFilter = targetBtn.dataset.project;
      AppState.currentFilterType = 'project';
    } else if (targetBtn.dataset.tag) {
      AppState.currentFilter = targetBtn.dataset.tag;
      AppState.currentFilterType = 'tag';
    }

    const title = targetBtn.dataset.title || targetBtn.querySelector('.item-left')?.textContent.trim() || 'Inbox';
    if (this.viewTitleEl) this.viewTitleEl.textContent = title;
    window.WorkspaceControls?.syncViewFromCurrentFilter();
    this.closeSidebar();
    window.TasksComponent?.render();
  },

  syncCurrentView() {
    const items = [...document.querySelectorAll('.sidebar-nav-item')];
    let target = null;
    if (AppState.currentFilterType === 'smart') {
      target = items.find(item => item.dataset.filter === AppState.currentFilter);
    } else if (AppState.currentFilterType === 'project') {
      target = items.find(item => item.dataset.project === AppState.currentFilter);
    } else if (AppState.currentFilterType === 'tag') {
      target = items.find(item => item.dataset.tag === AppState.currentFilter);
    }
    if (!target) {
      AppState.currentFilter = 'inbox';
      AppState.currentFilterType = 'smart';
      target = items.find(item => item.dataset.filter === 'inbox');
    }
    items.forEach(item => item.classList.toggle('active', item === target));
    const title = target?.dataset.title || target?.querySelector('.item-left')?.textContent.trim() || 'Inbox';
    if (this.viewTitleEl) this.viewTitleEl.textContent = title;
    window.WorkspaceControls?.syncViewFromCurrentFilter();
  },

  closeSidebarActionMenus() {
    this.taxonomyConfigs.forEach(config => {
      this[`${config.entityType}ListEl`]?.querySelectorAll(`.${config.entityType}-more-menu.open`)
        .forEach(menu => menu.classList.remove('open'));
    });
  },

  toggleSidebarActionMenu(menu) {
    const wasOpen = menu?.classList.contains('open');
    window.WorkspaceControls?.closeMenu();
    window.TasksComponent?.closeTaskActionMenu(false);
    this.closeSidebarActionMenus();
    if (menu && !wasOpen) menu.classList.add('open');
  },

  escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  },

  toggleSidebar() {
    if (this.sidebarEl?.classList.contains('open')) this.closeSidebar();
    else this.openSidebar();
  },

  setSidebarInert(value) {
    if (!this.sidebarEl) return;
    const inert = Boolean(value);
    this.sidebarEl.inert = inert;
    if (inert) this.sidebarEl.setAttribute('inert', '');
    else this.sidebarEl.removeAttribute('inert');
  },

  hasFocusInsideSidebar() {
    return Boolean(this.sidebarEl?.contains(document.activeElement));
  },

  moveFocusOutsideSidebar() {
    if (!this.hasFocusInsideSidebar()) return true;

    try {
      this.toggleBtn?.focus({ preventScroll: true });
    } catch (_) {
      this.toggleBtn?.focus();
    }
    if (!this.hasFocusInsideSidebar()) return true;

    const active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    return !this.hasFocusInsideSidebar();
  },

  openSidebar() {
    this.setSidebarInert(false);
    this.sidebarEl?.setAttribute('aria-hidden', 'false');
    this.sidebarEl?.classList.add('open');
    this.backdropEl?.classList.add('active');
    this.toggleBtn?.setAttribute('aria-expanded', 'true');
  },

  closeSidebar() {
    this.closeSidebarActionMenus();
    if (!this.moveFocusOutsideSidebar()) return false;

    this.setSidebarInert(true);
    this.sidebarEl?.setAttribute('aria-hidden', 'true');
    this.toggleBtn?.setAttribute('aria-expanded', 'false');
    this.sidebarEl?.classList.remove('open');
    this.backdropEl?.classList.remove('active');
    return true;
  },

  updateCounts() {
    const set = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    set('count-inbox', AppState.countInbox());
    set('count-today', AppState.countToday());
    set('count-completed', AppState.countCompleted());

    this.taxonomyConfigs.forEach(config => {
      const list = this[`${config.entityType}ListEl`];
      const countMethod = `count${config.stem}`;
      list?.querySelectorAll(`[data-${config.entityType}-id]`).forEach(item => {
        const count = item.querySelector('.item-count');
        if (count) count.textContent = AppState[countMethod](item.dataset[`${config.entityType}Id`]);
      });
    });
  }
};

export const SidebarComponent = {
  ...SidebarCore,
  ...SidebarProjectMethods,
  ...SidebarTagMethods,
  ...SidebarTaxonomyDragMethods,
  ...SidebarTaxonomyDragHierarchyMethods,
  ...SidebarTaxonomyDragTouchMethods,
  ...SidebarTaxonomyDragCommitMethods
};

window.SidebarComponent = SidebarComponent;
