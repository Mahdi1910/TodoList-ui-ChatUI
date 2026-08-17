import { AppState } from '../state.js';
import { TaxonomyOrder } from '../taxonomy-order.js';

const ICONS = {
  done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  date: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  priority: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  tags: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  project: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 7v10a2 2 0 002-2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

function actionButton(action, label, icon, extraClass = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `selection-action-cell ${extraClass}`.trim();
  button.dataset.bulkAction = action;
  button.innerHTML = `${icon}<span>${label}</span>`;
  return button;
}

export class TaskSelectionMenus {
  constructor(controller, actions) {
    this.controller = controller;
    this.actions = actions;
    this.panel = null;
    this.picker = null;
  }

  init() {
    this.createPanel();
    this.createPicker();
    document.addEventListener('click', event => {
      if (!this.controller.selectionMode) return;
      const fab = this.controller.getFab();
      if (fab?.contains(event.target) || this.panel?.contains(event.target) || this.picker?.contains(event.target)) return;
      this.closePicker(false);
      this.closePanel(false);
    });
    const reposition = () => {
      if (this.isPanelOpen()) this.positionPanel();
      if (this.isPickerOpen()) this.positionPicker();
    };
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
  }

  createPanel() {
    const panel = document.createElement('div');
    panel.id = 'task-selection-actions-panel';
    panel.className = 'task-selection-actions-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Selected task actions');

    const count = document.createElement('div');
    count.className = 'selection-action-count';
    count.dataset.selectionCount = 'true';

    const grid = document.createElement('div');
    grid.className = 'selection-action-grid';
    grid.append(
      actionButton('done', 'Done', ICONS.done),
      actionButton('date', 'Date', ICONS.date),
      actionButton('priority', 'Priority', ICONS.priority),
      actionButton('tags', 'Tags', ICONS.tags),
      actionButton('project', 'Project', ICONS.project),
      actionButton('delete', 'Delete', ICONS.delete, 'is-danger')
    );

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'selection-link-parent-action';
    link.dataset.bulkAction = 'link-parent';
    link.textContent = 'Link Parent Task';

    panel.append(count, grid, link);
    document.body.appendChild(panel);
    this.panel = panel;

    panel.addEventListener('click', event => {
      const button = event.target.closest('[data-bulk-action]');
      if (!button || button.disabled) return;
      event.stopPropagation();
      this.handleAction(button.dataset.bulkAction);
    });
  }

  createPicker() {
    const picker = document.createElement('div');
    picker.id = 'task-selection-picker';
    picker.className = 'task-selection-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'dialog');
    document.body.appendChild(picker);
    this.picker = picker;
  }

  isPanelOpen() {
    return Boolean(this.panel && !this.panel.hidden);
  }

  isPickerOpen() {
    return Boolean(this.picker && !this.picker.hidden);
  }

  togglePanel() {
    if (!this.controller.selectionMode || this.controller.getSelectionCount() === 0 || this.controller.batchBusy) return;
    if (this.isPanelOpen()) this.closePanel(true);
    else this.openPanel();
  }

  openPanel() {
    this.closePicker(false);
    this.syncPanel();
    this.panel.hidden = false;
    this.controller.getFab()?.setAttribute('aria-expanded', 'true');
    this.positionPanel();
    this.panel.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  closePanel(restoreFocus = false) {
    if (!this.panel || this.panel.hidden) return;
    this.closePicker(false);
    this.panel.hidden = true;
    this.controller.getFab()?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.controller.getFab()?.focus({ preventScroll: true });
  }

  closePicker(restoreFocus = false) {
    if (!this.picker || this.picker.hidden) return;
    this.picker.hidden = true;
    this.picker.innerHTML = '';
    if (restoreFocus) this.panel?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  closeTopLayer() {
    if (this.isPickerOpen()) {
      this.closePicker(true);
      return true;
    }
    if (this.isPanelOpen()) {
      this.closePanel(true);
      return true;
    }
    return false;
  }

  syncPanel() {
    if (!this.panel) return;
    const count = this.controller.getSelectionCount();
    const countEl = this.panel.querySelector('[data-selection-count]');
    if (countEl) countEl.textContent = `${count} selected`;
    this.panel.querySelectorAll('[data-bulk-action]').forEach(button => {
      button.disabled = this.controller.batchBusy || count === 0;
      button.removeAttribute('title');
    });

    const project = this.actions.getProjectEligibility();
    const projectButton = this.panel.querySelector('[data-bulk-action="project"]');
    if (projectButton && !project.valid) {
      projectButton.disabled = true;
      projectButton.title = project.reason;
    }

    const link = this.actions.getLinkParentEligibility();
    const linkButton = this.panel.querySelector('[data-bulk-action="link-parent"]');
    if (linkButton && !link.valid) {
      linkButton.disabled = true;
      linkButton.title = link.reason;
    }
  }

  positionPanel() {
    if (!this.isPanelOpen()) return;
    const fab = this.controller.getFab();
    if (!fab) return;
    const margin = 10;
    const gap = 10;
    const fabRect = fab.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();
    const left = Math.min(
      Math.max(margin, fabRect.right - panelRect.width),
      Math.max(margin, window.innerWidth - panelRect.width - margin)
    );
    let top = fabRect.top - panelRect.height - gap;
    if (top < margin) top = Math.min(window.innerHeight - panelRect.height - margin, fabRect.bottom + gap);
    this.panel.style.left = `${Math.round(left)}px`;
    this.panel.style.top = `${Math.max(margin, Math.round(top))}px`;
  }

  positionPicker() {
    if (!this.isPickerOpen()) return;
    const anchorRect = this.panel?.getBoundingClientRect();
    const pickerRect = this.picker.getBoundingClientRect();
    const margin = 10;
    const gap = 8;
    let left = anchorRect ? anchorRect.left : margin;
    let top = anchorRect ? anchorRect.top - pickerRect.height - gap : margin;
    if (top < margin && anchorRect) top = anchorRect.bottom + gap;
    left = Math.min(Math.max(margin, left), Math.max(margin, window.innerWidth - pickerRect.width - margin));
    top = Math.min(Math.max(margin, top), Math.max(margin, window.innerHeight - pickerRect.height - margin));
    this.picker.style.left = `${Math.round(left)}px`;
    this.picker.style.top = `${Math.round(top)}px`;
  }

  async handleAction(action) {
    if (action === 'done') {
      this.closePanel(false);
      await this.actions.markDone();
      return;
    }
    if (action === 'delete') {
      this.closePanel(false);
      await this.actions.deleteSelected();
      return;
    }
    if (action === 'date') return this.openDatePicker();
    if (action === 'priority') return this.openPriorityPicker();
    if (action === 'tags') return this.openTagPicker();
    if (action === 'project') return this.openProjectPicker();
    if (action === 'link-parent') return this.openParentPicker();
  }

  showPicker(title, options = []) {
    this.picker.innerHTML = '';
    const heading = document.createElement('div');
    heading.className = 'selection-picker-title';
    heading.textContent = title;
    const list = document.createElement('div');
    list.className = 'selection-picker-list';
    options.forEach(option => list.appendChild(option));
    this.picker.append(heading, list);
    this.picker.hidden = false;
    this.positionPicker();
    this.picker.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
  }

  pickerButton(label, onClick, { depth = 0, state = '', disabled = false } = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `selection-picker-option${state ? ` is-${state}` : ''}`;
    button.style.paddingInlineStart = `${12 + depth * 16}px`;
    button.disabled = disabled;
    const mark = document.createElement('span');
    mark.className = 'selection-picker-mark';
    mark.textContent = state === 'all' ? '✓' : state === 'some' ? '−' : '';
    const text = document.createElement('span');
    text.textContent = label;
    button.append(mark, text);
    button.addEventListener('click', async event => {
      event.stopPropagation();
      await onClick();
    });
    return button;
  }

  openPriorityPicker() {
    const values = [
      ['', 'None'],
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High']
    ];
    this.showPicker('Priority', values.map(([value, label]) =>
      this.pickerButton(label, async () => {
        this.closePicker(false);
        this.closePanel(false);
        await this.actions.setPriority(value);
      })
    ));
  }

  openTagPicker() {
    const rows = TaxonomyOrder.flattenTree('tag');
    this.showPicker('Tags', rows.map(({ item, depth }) => {
      const state = this.actions.getTagState(item.id);
      return this.pickerButton(`${item.icon || ''} ${item.name}`.trim(), async () => {
        await this.actions.toggleTag(item.id);
        if (this.controller.getSelectionCount() === 0) {
          this.closePicker(false);
          this.closePanel(false);
          return;
        }
        this.openTagPicker();
      }, { depth, state });
    }));
  }

  openProjectPicker() {
    const eligibility = this.actions.getProjectEligibility();
    if (!eligibility.valid) return;
    const options = [
      this.pickerButton('Inbox', async () => {
        this.closePicker(false);
        this.closePanel(false);
        await this.actions.setProject('');
      })
    ];
    TaxonomyOrder.flattenTree('project').forEach(({ item, depth }) => {
      options.push(this.pickerButton(`${item.icon || ''} ${item.name}`.trim(), async () => {
        this.closePicker(false);
        this.closePanel(false);
        await this.actions.setProject(item.id);
      }, { depth }));
    });
    this.showPicker('Project', options);
  }

  openParentPicker() {
    const eligibility = this.actions.getLinkParentEligibility();
    if (!eligibility.valid) return;
    const options = this.actions.getEligibleParentTasks().map(parent =>
      this.pickerButton(parent.title, async () => {
        this.closePicker(false);
        this.closePanel(false);
        await this.actions.linkParent(parent.id);
      })
    );
    this.showPicker('Link Parent Task', options);
  }

  openDatePicker() {
    const schedule = this.controller.schedule;
    if (!schedule?.open) return;
    const tasks = this.actions.getSelectedTasks();
    const dates = new Set(tasks.map(task => task.dueDate || ''));
    const initialDate = dates.size === 1 ? (tasks[0]?.dueDate || null) : null;
    const modal = document.getElementById('schedule-modal');
    modal?.classList.add('bulk-date-only');
    this.closePicker(false);
    this.closePanel(false);
    schedule.open(
      initialDate,
      null,
      ['none'],
      null,
      async result => {
        const chosenDate = result && typeof result === 'object' ? result.dueDate : result;
        await this.actions.setDate(chosenDate || null);
      },
      {
        returnFocusTarget: this.controller.getFab(),
        afterClose: () => {
          modal?.classList.remove('bulk-date-only');
          this.controller.getFab()?.focus({ preventScroll: true });
        }
      }
    );
  }
}
