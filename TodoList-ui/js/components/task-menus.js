import { AppState } from '../state.js';
export const TaskMenuMethods = {
  createProjectMenuItem(project, depth = 0) {
    const item = document.createElement('div');
    const selected = project.id === this.selectedProject;
    item.className = `context-menu-item${selected ? ' selected' : ''}`;
    item.dataset.project = project.id;
    item.style.paddingLeft = `${12 + depth * 16}px`;
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '-1');
    item.setAttribute('aria-selected', selected ? 'true' : 'false');

    const icon = document.createElement('span');
    icon.className = 'project-icon';
    icon.textContent = String(project.icon ?? '');

    const label = document.createElement('span');
    label.textContent = String(project.name ?? '');

    item.append(icon, document.createTextNode(' '), label);
    return item;
  },

  createTagMenuItem(tag, depth = 0) {
    const item = document.createElement('div');
    const selected = this.selectedTags.includes(tag.id);
    item.className = `context-menu-item multiselect${selected ? ' selected' : ''}`;
    item.dataset.tag = tag.id;
    item.style.paddingLeft = `${12 + depth * 16}px`;
    item.setAttribute('role', 'option');
    item.setAttribute('tabindex', '-1');
    item.setAttribute('aria-selected', selected ? 'true' : 'false');

    const check = document.createElement('span');
    check.className = 'check-box-icon';

    const label = document.createElement('span');
    label.textContent = `${String(tag.icon ?? '')} ${String(tag.name ?? '')}`;

    item.append(check, label);
    return item;
  },

  renderProjectMenu() {
    if (!this.menuProject) return;
    this.menuProject.innerHTML = '';

    const inboxItem = document.createElement('div');
    inboxItem.className = `context-menu-item${this.selectedProject === '' ? ' selected' : ''}`;
    inboxItem.dataset.project = '';
    inboxItem.textContent = 'Inbox';
    inboxItem.setAttribute('role', 'option');
    inboxItem.setAttribute('tabindex', '-1');
    inboxItem.setAttribute('aria-selected', this.selectedProject === '' ? 'true' : 'false');
    this.menuProject.appendChild(inboxItem);

    AppState.projects.forEach(project => {
      this.menuProject.appendChild(this.createProjectMenuItem(project));
    });
  },

  renderTagMenu() {
    if (!this.menuTags) return;
    this.menuTags.innerHTML = '';
    const renderLevel = (parentId, depth = 0) => {
      AppState.tags.filter(tag => (tag.parentId || null) === parentId).forEach(tag => {
        this.menuTags.appendChild(this.createTagMenuItem(tag, depth));
        renderLevel(tag.id, depth + 1);
      });
    };
    renderLevel(null);
    this.bindTagMenuItems();
  },

  getMenuInteractionFromClick(event) {
    return event?.detail === 0 ? 'keyboard' : 'pointer';
  },

  getPointerPreservedEditorFocus(event) {
    return this.getMenuInteractionFromClick(event) === 'pointer'
      ? this.getActiveEditorInput?.() || null
      : null;
  },

  bindContextMenuPointerGuard(menu) {
    if (!menu || menu.dataset.pointerFocusGuard === 'true') return;
    menu.dataset.pointerFocusGuard = 'true';
    menu.addEventListener('mousedown', event => {
      if (!event.target.closest('.context-menu-item')) return;
      const preserved = this.getContextMenuPortalMap().get(menu)?.preserveEditorFocus || null;
      if (preserved && document.activeElement === preserved) event.preventDefault();
    });
  },

  bindProjectMenuTrigger() {
    if (!this.btnProject || !this.menuProject) return;
    this.btnProject.setAttribute('aria-haspopup', 'listbox');
    this.btnProject.setAttribute('aria-expanded', 'false');
    this.menuProject.setAttribute('role', 'listbox');
    this.bindContextMenuPointerGuard(this.menuProject);
    this.btnProject.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleContextMenu(this.menuProject, this.btnProject, {
        interaction: this.getMenuInteractionFromClick(e),
        preserveEditorFocus: this.getPointerPreservedEditorFocus(e)
      });
    });
    this.btnProject.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openContextMenu(this.menuProject, this.btnProject, { interaction: 'keyboard' });
      }
    });
    this.menuProject.addEventListener('click', e => {
      const item = e.target.closest('.context-menu-item');
      if (!item) return;
      e.stopPropagation();
      this.selectMenuItem(item, this.menuProject, 'single', 'project');
    });
    this.menuProject.addEventListener('keydown', e => {
      const item = e.target.closest('.context-menu-item');
      if (item) this.handleMenuKeydown(e, item, this.menuProject, 'single', 'project');
    });
  },

  bindTagMenuTrigger() {
    if (!this.btnTags || !this.menuTags) return;
    this.btnTags.setAttribute('aria-haspopup', 'listbox');
    this.btnTags.setAttribute('aria-expanded', 'false');
    this.menuTags.setAttribute('role', 'listbox');
    this.bindContextMenuPointerGuard(this.menuTags);
    this.btnTags.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleContextMenu(this.menuTags, this.btnTags, {
        interaction: this.getMenuInteractionFromClick(e),
        preserveEditorFocus: this.getPointerPreservedEditorFocus(e)
      });
    });
    this.btnTags.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openContextMenu(this.menuTags, this.btnTags, { interaction: 'keyboard' });
      }
    });
  },

  bindTagMenuItems() {
    this.menuTags?.querySelectorAll('.context-menu-item').forEach(item => {
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.addEventListener('click', e => {
        e.stopPropagation();
        this.selectMenuItem(item, this.menuTags, 'multi', 'tag');
      });
      item.addEventListener('keydown', e => this.handleMenuKeydown(e, item, this.menuTags, 'multi', 'tag'));
    });
  },

  bindContextMenu(trigger, menu, mode, key) {
    if (!trigger || !menu) return;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    menu.setAttribute('role', 'listbox');
    this.bindContextMenuPointerGuard(menu);
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '-1');
      item.setAttribute('aria-selected', item.classList.contains('selected') ? 'true' : 'false');
      item.addEventListener('click', e => {
        e.stopPropagation();
        this.selectMenuItem(item, menu, mode, key);
      });
      item.addEventListener('keydown', e => this.handleMenuKeydown(e, item, menu, mode, key));
    });
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleContextMenu(menu, trigger, {
        interaction: this.getMenuInteractionFromClick(e),
        preserveEditorFocus: this.getPointerPreservedEditorFocus(e)
      });
    });
    trigger.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.openContextMenu(menu, trigger, { interaction: 'keyboard' });
      }
    });
  },

  selectMenuItem(item, menu, mode, key) {
    const value = item.dataset[key];
    if (mode === 'multi') {
      item.classList.toggle('selected');
      if (item.classList.contains('selected')) {
        if (!this.selectedTags.includes(value)) this.selectedTags.push(value);
      } else {
        this.selectedTags = this.selectedTags.filter(tag => tag !== value);
      }
    } else {
      menu.querySelectorAll('.context-menu-item').forEach(i => i.classList.remove('selected'));
      item.classList.add('selected');
      if (key === 'priority') this.selectedPriority = value;
      if (key === 'project') this.selectedProject = value;
    }
    this.syncMenuSelection(menu);
    const trigger = this.getContextMenuTrigger(menu);
    const shouldBeActive = mode === 'multi'
      ? this.selectedTags.length > 0
      : (key === 'project' ? Boolean(this.selectedProject)
        : key === 'priority' ? Boolean(this.selectedPriority) : true);
    trigger?.classList.toggle('active', shouldBeActive);
    if (mode === 'single') this.closeContextMenu(menu, trigger);
  },

  syncMenuSelection(menu) {
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.setAttribute('aria-selected', item.classList.contains('selected') ? 'true' : 'false');
    });
  },

  getContextMenuPortalMap() {
    if (!this._contextMenuPortals) this._contextMenuPortals = new Map();
    return this._contextMenuPortals;
  },

  getContextMenuTrigger(menu, fallback = null) {
    return this.getContextMenuPortalMap().get(menu)?.trigger || fallback || menu?.previousElementSibling || null;
  },

  mountContextMenu(menu, trigger, preserveEditorFocus = null) {
    const portals = this.getContextMenuPortalMap();
    if (portals.has(menu)) {
      portals.get(menu).preserveEditorFocus = preserveEditorFocus;
      return;
    }
    const placeholder = document.createComment(`context-menu:${menu.id || 'menu'}`);
    const parent = menu.parentNode;
    parent?.insertBefore(placeholder, menu);
    const host = trigger?.closest('.modal-overlay') || this.addTaskModal;
    if (!host) return;
    host.appendChild(menu);
    menu.classList.add('context-menu-portal');
    portals.set(menu, { placeholder, parent, trigger, host, preserveEditorFocus });
  },

  restoreContextMenu(menu) {
    const portals = this.getContextMenuPortalMap();
    const portal = portals.get(menu);
    if (!portal) return;
    menu.classList.remove('context-menu-portal');
    menu.style.removeProperty('top');
    menu.style.removeProperty('left');
    menu.style.removeProperty('right');
    menu.style.removeProperty('bottom');
    menu.style.removeProperty('max-height');
    if (portal.placeholder?.parentNode) portal.placeholder.replaceWith(menu);
    else portal.parent?.appendChild(menu);
    portals.delete(menu);
  },

  positionContextMenu(menu, trigger = this.getContextMenuTrigger(menu)) {
    if (!menu?.classList.contains('open') || !trigger) return;
    const portal = this.getContextMenuPortalMap().get(menu);
    const host = portal?.host || trigger.closest('.modal-overlay') || this.addTaskModal;
    if (!host) return;

    const hostRect = host.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const gap = 8;
    const edge = 8;
    const spaceAbove = Math.max(0, triggerRect.top - hostRect.top - gap - edge);
    const spaceBelow = Math.max(0, hostRect.bottom - triggerRect.bottom - gap - edge);

    menu.style.top = '0px';
    menu.style.left = '0px';
    menu.style.bottom = 'auto';
    menu.style.right = 'auto';
    menu.style.maxHeight = `${Math.max(80, Math.floor(Math.max(spaceAbove, spaceBelow)))}px`;

    const preferredHeight = Math.min(menu.scrollHeight, 320);
    const openAbove = spaceAbove >= Math.min(preferredHeight, 140) || spaceAbove >= spaceBelow;
    const available = Math.max(80, Math.floor(openAbove ? spaceAbove : spaceBelow));
    menu.style.maxHeight = `${available}px`;

    const rect = menu.getBoundingClientRect();
    const left = Math.min(
      Math.max(edge, triggerRect.left - hostRect.left),
      Math.max(edge, hostRect.width - rect.width - edge)
    );
    let top = openAbove
      ? triggerRect.top - hostRect.top - gap - rect.height
      : triggerRect.bottom - hostRect.top + gap;
    top = Math.min(Math.max(edge, top), Math.max(edge, hostRect.height - rect.height - edge));

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  },

  ensureContextMenuViewportListeners() {
    if (this._contextMenuViewportListenersBound) return;
    this._contextMenuViewportListenersBound = true;
    const reposition = () => this.positionOpenContextMenus();
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    window.addEventListener('resize', reposition);
  },

  positionOpenContextMenus() {
    [this.menuPriority, this.menuTags, this.menuProject].forEach(menu => {
      if (menu?.classList.contains('open')) this.positionContextMenu(menu);
    });
  },

  toggleContextMenu(menu, trigger, options = {}) {
    if (menu.classList.contains('open')) this.closeContextMenu(menu, trigger);
    else this.openContextMenu(menu, trigger, options);
  },

  openContextMenu(menu, trigger, { interaction = 'keyboard', preserveEditorFocus = null } = {}) {
    window.WorkspaceControls?.closeMenu();
    this.closeTaskActionMenu?.(false);
    this.closeAllContextMenus();
    this.mountContextMenu(menu, trigger, preserveEditorFocus);
    menu.classList.add('open');
    trigger?.setAttribute('aria-expanded', 'true');
    this.ensureContextMenuViewportListeners();
    this.positionContextMenu(menu, trigger);
    requestAnimationFrame(() => this.positionContextMenu(menu, trigger));

    if (interaction === 'keyboard') {
      const first = menu.querySelector('.context-menu-item.selected') || menu.querySelector('.context-menu-item');
      first?.focus();
    }
  },

  closeContextMenu(menu, trigger = this.getContextMenuTrigger(menu)) {
    if (!menu) return;
    const resolvedTrigger = this.getContextMenuTrigger(menu, trigger);
    menu.classList.remove('open');
    resolvedTrigger?.setAttribute('aria-expanded', 'false');
    this.restoreContextMenu(menu);
  },

  closeAllContextMenus() {
    [this.menuPriority, this.menuTags, this.menuProject].forEach(menu => {
      if (menu) this.closeContextMenu(menu);
    });
  },

  handleMenuKeydown(e, item, menu, mode, key) {
    const items = [...menu.querySelectorAll('.context-menu-item')];
    const index = items.indexOf(item);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.selectMenuItem(item, menu, mode, key);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const trigger = this.getContextMenuTrigger(menu);
      this.closeContextMenu(menu, trigger);
      trigger?.focus();
    }
  },

};
