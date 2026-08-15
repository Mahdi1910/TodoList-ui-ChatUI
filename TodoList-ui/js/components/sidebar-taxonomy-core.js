import { ModalFocusManager } from './modal-focus.js';
import { TaxonomyOrder } from '../taxonomy-order.js';
import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';
export const SidebarTaxonomyCore = (() => {
  const prop = (config, suffix) => `${config.entityType}${suffix}`;
  const selectedIconProp = config => `selected${config.stem}Icon`;
  const selectedViewProp = config => `selected${config.stem}View`;
  const editingProp = config => `editing${config.stem}Id`;
  const getMethod = config => `get${config.stem}`;
  const descendantMethod = config => `is${config.stem}Descendant`;
  const countMethod = config => `count${config.stem}`;
  const serviceMethod = (config, action) => `${action}${config.stem}`;
  const renderTaskMenuMethod = config => `render${config.stem}Menu`;
  function initialize(host, config) {
    const type = config.entityType;
    host[prop(config, 'ListEl')] = document.getElementById(`${type}-list`);
    host[prop(config, 'Modal')] = document.getElementById(`${type}-modal`);
    host[prop(config, 'Form')] = document.getElementById(`${type}-form`);
    host[prop(config, 'NameInput')] = document.getElementById(`${type}-name-input`);
    host[prop(config, 'IconTrigger')] = document.getElementById(`${type}-icon-trigger`);
    host[prop(config, 'IconPicker')] = document.getElementById(`${type}-icon-picker`);
    host[prop(config, 'ParentSelect')] = document.getElementById(`${type}-parent-select`);
    host[prop(config, 'ModalTitle')] = document.getElementById(`${type}-modal-title`);
    host[prop(config, 'SaveBtn')] = document.getElementById(`btn-save-${type}`);
    host[selectedIconProp(config)] = '●';
    host[selectedViewProp(config)] = 'list';
    host[editingProp(config)] = null;
  }
  function render(host, config) {
    const list = host[prop(config, 'ListEl')];
    if (!list) return;
    list.innerHTML = '';
    list.classList.add('sidebar-tree-root');
    list.dataset.taxonomyType = config.entityType;
    list.dataset.treeParentId = '';
    TaxonomyOrder.getChildren(config.entityType, null)
      .forEach(entity => list.appendChild(createTreeNode(host, config, entity, 0)));
  }
  function createTreeNode(host, config, entity, depth = 0) {
    const type = config.entityType;
    const node = document.createElement('div');
    node.className = `sidebar-tree-node ${type}-tree-node`;
    node.dataset.taxonomyType = type;
    node.dataset.entityId = entity.id;
    node.dataset.parentId = entity.parentId || '';
    node.dataset.depth = String(depth);
    const item = document.createElement('div');
    item.className = `sidebar-nav-item ${type}-nav-item`;
    item.dataset[type] = entity.id;
    item.dataset[`${type}Id`] = entity.id;
    item.dataset.title = entity.name;
    const left = document.createElement('span');
    left.className = 'item-left taxonomy-select-control';
    left.dataset.taxonomySelect = entity.id;
    left.setAttribute('role', 'button');
    left.setAttribute('tabindex', '0');
    left.setAttribute('aria-label', `Select ${config.stem} ${entity.name}`);
    const icon = document.createElement('span');
    icon.className = `${type}-icon`;
    icon.textContent = entity.icon;
    const name = document.createElement('span');
    name.className = `${type}-name`;
    name.textContent = entity.name;
    left.append(icon, name);
    const right = document.createElement('span');
    right.className = `${type}-nav-right`;
    const count = document.createElement('span');
    count.className = 'item-count';
    count.textContent = AppState[countMethod(config)](entity.id);
    const more = document.createElement('button');
    more.type = 'button';
    more.className = `${type}-more-btn`;
    more.dataset[`${type}Menu`] = entity.id;
    more.setAttribute('aria-label', `More options for ${entity.name}`);
    more.textContent = '⋯';
    right.append(count, more);
    const menu = document.createElement('div');
    menu.className = `${type}-more-menu`;
    menu.dataset[`${type}MenuPanel`] = entity.id;
    const actions = [
      [`${type}AddChild`, `Add ${config.childLabel}`],
      [`${type}Edit`, 'Edit'],
      [`${type}Delete`, 'Delete']
    ];
    actions.forEach(([datasetKey, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset[datasetKey] = entity.id;
      button.textContent = label;
      menu.appendChild(button);
    });
    more.addEventListener('click', event => {
      event.stopPropagation();
      host.toggleSidebarActionMenu(menu);
    });
    const children = document.createElement('div');
    children.className = 'sidebar-tree-children';
    children.dataset.taxonomyType = type;
    children.dataset.treeParentId = entity.id;
    TaxonomyOrder.getChildren(type, entity.id)
      .forEach(child => children.appendChild(createTreeNode(host, config, child, depth + 1)));
    item.append(left, right, menu);
    node.append(item, children);
    return node;
  }
  function setViewSelection(host, config, selectedView) {
    const modal = host[prop(config, 'Modal')];
    modal?.querySelectorAll('[data-taxonomy-view]').forEach(button => {
      const selected = button.dataset.taxonomyView === selectedView;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
      button.onclick = () => {
        host[selectedViewProp(config)] = button.dataset.taxonomyView;
        setViewSelection(host, config, button.dataset.taxonomyView);
      };
    });
  }
  function populateParentSelect(host, config, entityId, entity, parentId) {
    const select = host[prop(config, 'ParentSelect')];
    if (!select) return;
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = config.topLevelLabel;
    select.appendChild(none);
    TaxonomyOrder.flattenTree(config.entityType).forEach(({ item: candidate, depth }) => {
      const isDescendant = entityId && AppState[descendantMethod(config)](candidate.id, entityId);
      if (candidate.id === entityId || isDescendant) return;
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = `${'  '.repeat(depth)}${candidate.icon} ${candidate.name}`;
      select.appendChild(option);
    });
    select.value = entity?.parentId || parentId || '';
  }
  function openModal(host, config, entityId = null, parentId = null) {
    const modal = host[prop(config, 'Modal')];
    const nameInput = host[prop(config, 'NameInput')];
    const iconTrigger = host[prop(config, 'IconTrigger')];
    const iconPicker = host[prop(config, 'IconPicker')];
    const modalTitle = host[prop(config, 'ModalTitle')];
    const saveBtn = host[prop(config, 'SaveBtn')];
    const entity = entityId ? AppState[getMethod(config)](entityId) : null;
    host[editingProp(config)] = entityId;
    host[selectedIconProp(config)] = entity?.icon || '●';
    host[selectedViewProp(config)] = entity?.viewType || 'list';
    if (modalTitle) modalTitle.textContent = entity ? `Edit ${config.stem}` : `New ${config.stem}`;
    if (saveBtn) saveBtn.textContent = entity ? 'Save Changes' : `Create ${config.stem}`;
    if (nameInput) nameInput.value = entity?.name || '';
    if (iconTrigger) {
      iconTrigger.textContent = host[selectedIconProp(config)];
      iconTrigger.setAttribute('aria-expanded', 'false');
    }
    iconPicker?.classList.remove('open');
    iconPicker?.querySelectorAll('[data-icon]').forEach(button =>
      button.classList.toggle('selected', button.dataset.icon === host[selectedIconProp(config)]));
    populateParentSelect(host, config, entityId, entity, parentId);
    setViewSelection(host, config, host[selectedViewProp(config)]);
    ModalFocusManager.open(modal, {
      trigger: document.activeElement,
      initialFocus: nameInput,
      fallbackFocus: document.getElementById(`btn-add-${config.entityType}`) || host.toggleBtn
    });
    document.body.classList.add('modal-open');
  }
  function selectIcon(host, config, icon) {
    host[selectedIconProp(config)] = icon;
    const trigger = host[prop(config, 'IconTrigger')];
    const picker = host[prop(config, 'IconPicker')];
    if (trigger) {
      trigger.textContent = icon;
      trigger.setAttribute('aria-expanded', 'false');
    }
    picker?.querySelectorAll('[data-icon]').forEach(button =>
      button.classList.toggle('selected', button.dataset.icon === icon));
    picker?.classList.remove('open');
    host[prop(config, 'NameInput')]?.focus();
  }
  function closeModal(host, config) {
    const modal = host[prop(config, 'Modal')];
    ModalFocusManager.close(modal, {
      fallbackFocus: document.getElementById(`btn-add-${config.entityType}`) || host.toggleBtn
    });
    document.body.classList.remove('modal-open');
    host[prop(config, 'IconPicker')]?.classList.remove('open');
    host[editingProp(config)] = null;
  }
  function refreshAfterMutation(host, config) {
    render(host, config);
    window.TasksComponent?.[renderTaskMenuMethod(config)]?.();
    host.syncCurrentView();
    host.updateCounts();
    window.TasksComponent?.render();
  }
  async function save(host, config) {
    const nameInput = host[prop(config, 'NameInput')];
    const saveBtn = host[prop(config, 'SaveBtn')];
    const parentSelect = host[prop(config, 'ParentSelect')];
    const name = nameInput?.value.trim() || '';
    if (!name) return nameInput?.reportValidity();
    const data = {
      name,
      icon: host[selectedIconProp(config)],
      viewType: host[selectedViewProp(config)],
      parentId: parentSelect?.value || null
    };
    if (saveBtn) saveBtn.disabled = true;
    try {
      const editingId = host[editingProp(config)];
      if (editingId) await AppDataService[serviceMethod(config, 'update')](editingId, data);
      else await AppDataService[serviceMethod(config, 'create')](data);
      closeModal(host, config);
      refreshAfterMutation(host, config);
    } catch (error) {
      AppPersistence.reportError(`Could not save this ${config.entityType}.`, error);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }
  async function remove(host, config, entityId) {
    const entity = AppState[getMethod(config)](entityId);
    if (!entity || !window.confirm(config.deletePrompt(entity.name))) return;
    try {
      await AppDataService[serviceMethod(config, 'delete')](entityId);
      refreshAfterMutation(host, config);
    } catch (error) {
      AppPersistence.reportError(`Could not delete this ${config.entityType}.`, error);
    }
  }
  function bindEvents(host, config) {
    const type = config.entityType;
    const modal = host[prop(config, 'Modal')];
    const form = host[prop(config, 'Form')];
    const picker = host[prop(config, 'IconPicker')];
    const trigger = host[prop(config, 'IconTrigger')];
    const list = host[prop(config, 'ListEl')];
    document.getElementById(`btn-add-${type}`)?.addEventListener('click', () => openModal(host, config));
    document.getElementById(`btn-close-${type}-modal`)?.addEventListener('click', () => closeModal(host, config));
    modal?.addEventListener('click', event => { if (event.target === modal) closeModal(host, config); });
    modal?.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(host, config); });
    form?.addEventListener('submit', event => { event.preventDefault(); save(host, config); });
    trigger?.addEventListener('click', event => {
      event.stopPropagation();
      picker?.classList.toggle('open');
      trigger.setAttribute('aria-expanded', picker?.classList.contains('open') ? 'true' : 'false');
    });
    picker?.querySelectorAll('[data-icon]').forEach(button =>
      button.addEventListener('click', () => selectIcon(host, config, button.dataset.icon)));
    list?.addEventListener('click', event => {
      const addChild = event.target.closest(`[data-${type}-add-child]`);
      const edit = event.target.closest(`[data-${type}-edit]`);
      const removeButton = event.target.closest(`[data-${type}-delete]`);
      const item = event.target.closest(`[data-${type}-id]`);
      if (addChild) {
        event.stopPropagation();
        host.closeSidebarActionMenus();
        openModal(host, config, null, addChild.dataset[`${type}AddChild`]);
      } else if (edit) {
        event.stopPropagation();
        host.closeSidebarActionMenus();
        openModal(host, config, edit.dataset[`${type}Edit`]);
      } else if (removeButton) {
        event.stopPropagation();
        host.closeSidebarActionMenus();
        remove(host, config, removeButton.dataset[`${type}Delete`]);
      } else if (item) {
        host.selectFilter(item);
      }
    });
    list?.addEventListener('keydown', event => {
      const control = event.target.closest('[data-taxonomy-select]');
      if (!control || !list.contains(control) || (event.key !== 'Enter' && event.key !== ' ')) return;
      const item = control.closest(`[data-${type}-id]`);
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      host.selectFilter(item);
    });
  }
  function closeIconPicker(host, config) {
    host[prop(config, 'IconPicker')]?.classList.remove('open');
    host[prop(config, 'IconTrigger')]?.setAttribute('aria-expanded', 'false');
  }
  function createMethods(config) {
    return {
      [`render${config.pluralStem}`]() { return render(this, config); },
      [`create${config.stem}TreeNode`](entity, depth = 0) { return createTreeNode(this, config, entity, depth); },
      [`open${config.stem}Modal`](entityId = null, parentId = null) { return openModal(this, config, entityId, parentId); },
      [`select${config.stem}Icon`](icon) { return selectIcon(this, config, icon); },
      [`save${config.stem}`]() { return save(this, config); },
      [`delete${config.stem}`](entityId) { return remove(this, config, entityId); },
      [`close${config.stem}Modal`]() { return closeModal(this, config); }
    };
  }
  return { initialize, bindEvents, closeIconPicker, createMethods };
})();
