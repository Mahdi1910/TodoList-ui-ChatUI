import { AppState } from '../state.js';
import { TaskAfter } from '../task-after.js';

export const ScheduleAfterMethods = {
  initAfterUi() {
    if (this.tabAfter) return;
    const tabs = this.modalEl?.querySelector('.schedule-tabs');
    const footer = this.modalEl?.querySelector('.schedule-footer');
    if (!tabs || !footer) return;

    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'schedule-tab-btn';
    tab.id = 'tab-sched-after';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panel-sched-after');
    tab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h8m-3-3 3 3-3 3M5 5v14"/>
      </svg>
      <span>After</span>`;
    tabs.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'schedule-tab-panel after-schedule-panel';
    panel.id = 'panel-sched-after';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.innerHTML = `
      <div class="after-panel-header">
        <span class="after-panel-title">Schedule after another task</span>
        <span class="after-panel-subtitle">The date and time are assigned when that task is completed.</span>
      </div>

      <div class="after-wheel-labels" aria-hidden="true">
        <span>Mode</span><span>Hours</span><span>Minutes</span>
      </div>
      <div class="time-picker-container after-wheels-container" role="group" aria-label="After delay selection">
        <div class="wheel-mask top" aria-hidden="true"></div>
        <div class="wheel-mask bottom" aria-hidden="true"></div>
        <div class="selection-highlight" aria-hidden="true"></div>
        <div class="time-wheel after-label-wheel" id="wheel-after-label" role="listbox" aria-label="After label"></div>
        <div class="time-wheel" id="wheel-after-hours" role="listbox" aria-label="After delay hours" tabindex="0"></div>
        <div class="time-wheel" id="wheel-after-minutes" role="listbox" aria-label="After delay minutes" tabindex="0"></div>
      </div>

      <div class="after-task-section">
        <button type="button" class="after-task-trigger" id="btn-after-task-trigger" aria-haspopup="menu" aria-expanded="false">
          <span class="after-task-trigger-left"><span aria-hidden="true">✓</span><span>Task</span></span>
          <span class="after-task-value"><span id="after-task-value">Choose task</span><span aria-hidden="true">›</span></span>
        </button>
        <div class="after-task-menu" id="menu-after-task" role="menu" aria-label="Choose predecessor task"></div>
      </div>

      <div class="reminder-section after-reminder-section">
        <button type="button" class="reminder-trigger-btn" id="btn-after-reminder-trigger" aria-haspopup="menu" aria-expanded="false">
          <span class="reminder-trigger-left"><span class="reminder-icon">🔔</span><span>Reminder</span></span>
          <span class="reminder-trigger-val" id="after-reminder-value-display">On time</span>
        </button>
        <div class="reminder-menu" id="menu-after-reminder" role="menu" aria-label="After reminder options">
          <div class="reminder-menu-item" data-reminder="none" role="menuitemcheckbox" aria-checked="false"><span>None</span><span class="rem-check-icon">✓</span></div>
          <div class="reminder-menu-item" data-reminder="on_time" role="menuitemcheckbox" aria-checked="false"><span>On time</span><span class="rem-check-icon">✓</span></div>
          <div class="reminder-menu-item" data-reminder="5_min" role="menuitemcheckbox" aria-checked="false"><span>5 minutes before</span><span class="rem-check-icon">✓</span></div>
          <div class="reminder-menu-item" data-reminder="10_min" role="menuitemcheckbox" aria-checked="false"><span>10 minutes before</span><span class="rem-check-icon">✓</span></div>
          <div class="reminder-menu-item" data-reminder="15_min" role="menuitemcheckbox" aria-checked="false"><span>15 minutes before</span><span class="rem-check-icon">✓</span></div>
          <div data-custom-reminders-list></div>
          <div class="reminder-menu-item custom-action" data-open-custom-reminder role="menuitem"><span>Custom...</span></div>
        </div>
      </div>

      <div class="after-validation-message" id="after-validation-message" role="status" aria-live="polite"></div>
      <div class="after-actions-row">
        <button type="button" class="btn-sched-clear-after" id="btn-sched-clear-after">Clear After</button>
      </div>`;
    footer.insertAdjacentElement('beforebegin', panel);

    this.tabAfter = tab;
    this.panelAfter = panel;
    this.wheelAfterLabel = panel.querySelector('#wheel-after-label');
    this.wheelAfterHours = panel.querySelector('#wheel-after-hours');
    this.wheelAfterMinutes = panel.querySelector('#wheel-after-minutes');
    this.btnAfterTaskTrigger = panel.querySelector('#btn-after-task-trigger');
    this.afterTaskValue = panel.querySelector('#after-task-value');
    this.menuAfterTask = panel.querySelector('#menu-after-task');
    this.btnAfterReminderTrigger = panel.querySelector('#btn-after-reminder-trigger');
    this.menuAfterReminder = panel.querySelector('#menu-after-reminder');
    this.afterReminderValDisplay = panel.querySelector('#after-reminder-value-display');
    this.afterCustomRemindersContainer = panel.querySelector('[data-custom-reminders-list]');
    this.btnOpenCustomReminderAfter = panel.querySelector('[data-open-custom-reminder]');
    this.afterValidationMessage = panel.querySelector('#after-validation-message');
    this.btnClearAfter = panel.querySelector('#btn-sched-clear-after');

    this.populateWheel(this.wheelAfterLabel, ['After']);
    this.populateWheel(this.wheelAfterHours, Array.from({ length: TaskAfter.MAX_HOURS + 1 }, (_, index) => String(index)));
    this.populateWheel(this.wheelAfterMinutes, Array.from({ length: TaskAfter.MAX_MINUTES + 1 }, (_, index) => String(index)));
    this.bindWheelEngine(this.wheelAfterHours, '');
    this.bindWheelEngine(this.wheelAfterMinutes, '');
    this.bindAfterWheel(this.wheelAfterHours, index => this.setAfterHours(index));
    this.bindAfterWheel(this.wheelAfterMinutes, index => this.setAfterMinutes(index));
    this.scrollWheelToIndex(this.wheelAfterLabel, 0, false, '');
  },

  bindAfterEvents() {
    this.tabAfter?.addEventListener('click', () => this.switchTab('after'));
    this.btnAfterTaskTrigger?.addEventListener('click', event => {
      event.stopPropagation();
      this.closeReminderMenu?.();
      this.toggleAfterTaskMenu();
    });
    this.menuAfterTask?.addEventListener('click', event => {
      const item = event.target.closest('[data-after-task-id]');
      if (!item || item.disabled) return;
      event.stopPropagation();
      this.selectAfterTask(item.dataset.afterTaskId);
      this.closeAfterTaskMenu();
    });
    this.btnClearAfter?.addEventListener('click', () => this.clearAfterDraft());
    document.addEventListener('click', event => {
      if (this.menuAfterTask?.classList.contains('open') &&
          !this.menuAfterTask.contains(event.target) && event.target !== this.btnAfterTaskTrigger) {
        this.closeAfterTaskMenu();
      }
    });
  },

  bindAfterWheel(wheel, onChange) {
    if (!wheel) return;
    let timer = null;
    wheel.addEventListener('scroll', () => {
      if (this._syncingAfterWheels) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (this._syncingAfterWheels) return;
        const index = Math.max(0, Math.min(wheel._maxIndex, Math.round(wheel.scrollTop / this.ITEM_HEIGHT)));
        onChange(index);
      }, 100);
    });
    wheel.addEventListener('click', event => {
      if (this._syncingAfterWheels) return;
      const item = event.target.closest('.wheel-item');
      if (!item) return;
      const items = [...wheel.querySelectorAll('.wheel-item')];
      const index = items.indexOf(item);
      if (index >= 0) onChange(index);
    });
  },

  ensureAfterDraft() {
    if (!this.draftAfter) {
      this.draftAfter = { taskId: null, hours: 0, minutes: 0, resolvedAt: null };
    }
    return this.draftAfter;
  },

  activatePendingAfter() {
    const draft = this.ensureAfterDraft();
    draft.resolvedAt = null;
    this.draftDate = null;
    this.draftTime = null;
    this.draftRepeat = { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } };
    this.clearRepeatValidationError?.();
    this.renderCalendar?.();
    this.renderRepeatEndRow?.();
  },

  setAfterHours(hours) {
    const draft = this.ensureAfterDraft();
    const next = Math.max(0, Math.min(TaskAfter.MAX_HOURS, Number(hours) || 0));
    if (draft.hours === next && !draft.resolvedAt) return;
    draft.hours = next;
    this.activatePendingAfter();
    this.clearAfterValidationError();
  },

  setAfterMinutes(minutes) {
    const draft = this.ensureAfterDraft();
    const next = Math.max(0, Math.min(TaskAfter.MAX_MINUTES, Number(minutes) || 0));
    if (draft.minutes === next && !draft.resolvedAt) return;
    draft.minutes = next;
    this.activatePendingAfter();
    this.clearAfterValidationError();
  },

  selectAfterTask(taskId) {
    const draft = this.ensureAfterDraft();
    if (draft.taskId === taskId && !draft.resolvedAt) return;
    draft.taskId = taskId;
    this.activatePendingAfter();
    this.clearAfterValidationError();
    this.renderAfterTaskValue();
  },

  clearAfterDraft() {
    this.draftAfter = null;
    this.clearAfterValidationError();
    this.closeAfterTaskMenu();
    this.renderAfterPanel();
  },

  syncAfterWheels() {
    const draft = this.draftAfter || { hours: 0, minutes: 0 };
    const hours = Math.max(0, Math.min(TaskAfter.MAX_HOURS, Number(draft.hours) || 0));
    const minutes = Math.max(0, Math.min(TaskAfter.MAX_MINUTES, Number(draft.minutes) || 0));
    this._syncingAfterWheels = true;
    clearTimeout(this._afterWheelSyncTimer);
    requestAnimationFrame(() => {
      this.scrollWheelToIndex(this.wheelAfterLabel, 0, false, '');
      this.scrollWheelToIndex(this.wheelAfterHours, hours, false, '');
      this.scrollWheelToIndex(this.wheelAfterMinutes, minutes, false, '');
      this._afterWheelSyncTimer = setTimeout(() => {
        this._syncingAfterWheels = false;
      }, 140);
    });
  },

  renderAfterPanel() {
    this.syncAfterWheels();
    this.renderAfterTaskValue();
    this.btnClearAfter?.toggleAttribute('hidden', !this.draftAfter);
  },

  renderAfterTaskValue() {
    if (!this.afterTaskValue) return;
    const source = this.draftAfter?.taskId ? AppState.getTask(this.draftAfter.taskId) : null;
    this.afterTaskValue.textContent = source?.title || 'Choose task';
    this.btnAfterTaskTrigger?.classList.toggle('selected', Boolean(source));
  },

  toggleAfterTaskMenu() {
    if (this.menuAfterTask?.classList.contains('open')) this.closeAfterTaskMenu();
    else this.openAfterTaskMenu();
  },

  openAfterTaskMenu() {
    if (!this.menuAfterTask) return;
    this.renderAfterTaskMenu();
    this.menuAfterTask.classList.add('open');
    this.btnAfterTaskTrigger?.setAttribute('aria-expanded', 'true');
  },

  closeAfterTaskMenu() {
    this.menuAfterTask?.classList.remove('open');
    this.btnAfterTaskTrigger?.setAttribute('aria-expanded', 'false');
  },

  renderAfterTaskMenu() {
    if (!this.menuAfterTask) return;
    this.menuAfterTask.innerHTML = '';
    const selectedId = this.draftAfter?.taskId || null;
    const selected = selectedId ? AppState.getTask(selectedId) : null;
    const candidates = TaskAfter.eligibleSources(AppState.tasks, this.scheduleTaskId || null);
    const rows = [];
    if (selected && !candidates.some(task => task.id === selected.id)) rows.push({ task: selected, locked: true });
    candidates.forEach(task => rows.push({ task, locked: false }));

    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'after-task-menu-empty';
      empty.textContent = 'No active tasks available.';
      this.menuAfterTask.appendChild(empty);
      return;
    }

    rows.forEach(({ task, locked }) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `after-task-menu-item${task.id === selectedId ? ' selected' : ''}`;
      button.dataset.afterTaskId = task.id;
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', task.id === selectedId ? 'true' : 'false');
      if (locked) button.disabled = true;

      const text = document.createElement('span');
      text.className = 'after-task-menu-title';
      text.textContent = task.title;
      button.appendChild(text);

      if (task.after && !task.after.resolvedAt) {
        const chain = document.createElement('span');
        chain.className = 'after-task-menu-meta';
        chain.textContent = `After ${TaskAfter.formatDelay(task.after)}`;
        button.appendChild(chain);
      } else if (locked && task.completed) {
        const completed = document.createElement('span');
        completed.className = 'after-task-menu-meta';
        completed.textContent = 'Completed';
        button.appendChild(completed);
      }
      this.menuAfterTask.appendChild(button);
    });
  },

  validateAfterDraft() {
    if (!this.draftAfter) return { valid: true, after: null };
    const check = TaskAfter.validate(this.draftAfter);
    if (!check.valid) return check;
    const after = check.after;
    const source = AppState.getTask(after.taskId);
    if (!source) return { valid: false, message: 'The selected predecessor task no longer exists.' };
    if (this.scheduleTaskId && source.id === this.scheduleTaskId) {
      return { valid: false, message: 'A task cannot be scheduled after itself.' };
    }
    if (TaskAfter.wouldCreateCycle(this.scheduleTaskId, source.id, AppState.tasks)) {
      return { valid: false, message: 'This After relationship would create a task cycle.' };
    }
    if (!after.resolvedAt && source.completed) {
      return { valid: false, message: 'Choose an active task. Completed tasks cannot start a new After schedule.' };
    }
    return { valid: true, after };
  },

  showAfterValidationError(message) {
    if (this.afterValidationMessage) this.afterValidationMessage.textContent = message || 'Complete the After settings.';
    return false;
  },

  clearAfterValidationError() {
    if (this.afterValidationMessage) this.afterValidationMessage.textContent = '';
  }
};
