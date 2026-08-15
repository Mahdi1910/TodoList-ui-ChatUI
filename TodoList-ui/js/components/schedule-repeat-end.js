import { ModalFocusManager } from './modal-focus.js';
import { RepeatEngine } from '../repeat/repeat-engine.js';
export const ScheduleRepeatEndMethods = {
  initRepeatEndUi() {
    if (this.repeatEndsRow) return;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'repeat-ends-row';
    row.hidden = true;
    row.innerHTML = '<span>Ends</span><span class="repeat-ends-value"><span data-repeat-end-value>Never</span><span aria-hidden="true">›</span></span>';
    this.repeatOptionsList?.insertAdjacentElement('afterend', row);
    this.repeatEndsRow = row;
    this.repeatEndsValue = row.querySelector('[data-repeat-end-value]');

    const mainError = document.createElement('div');
    mainError.className = 'repeat-validation-message';
    mainError.setAttribute('role', 'status');
    mainError.setAttribute('aria-live', 'polite');
    this.repeatSummaryText?.parentElement?.insertAdjacentElement('afterend', mainError);
    this.repeatMainValidationMessage = mainError;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay repeat-end-overlay';
    modal.id = 'repeat-end-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-card repeat-end-card">
        <div class="modal-header">
          <h3 class="modal-title">Repeat Ends</h3>
          <button type="button" class="modal-close-btn" data-repeat-end-close aria-label="Close repeat end dialog">&times;</button>
        </div>
        <span class="repeat-end-label">End by</span>
        <div class="time-picker-container repeat-end-type-wheel" role="group" aria-label="Repeat ending mode">
          <div class="wheel-mask top" aria-hidden="true"></div><div class="wheel-mask bottom" aria-hidden="true"></div><div class="selection-highlight" aria-hidden="true"></div>
          <div class="time-wheel" data-repeat-end-type-wheel role="listbox" tabindex="0" aria-label="Repeat ending mode"></div>
        </div>
        <div class="repeat-end-conditional" data-repeat-end-date hidden>
          <div class="calendar-header repeat-end-calendar-header">
            <button type="button" class="calendar-nav-btn" data-repeat-end-prev aria-label="Previous Month">‹</button>
            <span class="calendar-title" data-repeat-end-month></span>
            <button type="button" class="calendar-nav-btn" data-repeat-end-next aria-label="Next Month">›</button>
          </div>
          <div class="calendar-weekdays" aria-hidden="true"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div>
          <div class="calendar-grid repeat-end-calendar-grid" data-repeat-end-grid role="grid" aria-label="Repeat end date"></div>
        </div>
        <div class="repeat-end-conditional" data-repeat-end-count hidden>
          <div class="time-picker-container repeat-end-count-wheel" role="group" aria-label="Repeat occurrence count">
            <div class="wheel-mask top" aria-hidden="true"></div><div class="wheel-mask bottom" aria-hidden="true"></div><div class="selection-highlight" aria-hidden="true"></div>
            <div class="time-wheel" data-repeat-end-count-wheel role="listbox" tabindex="0" aria-label="Number of occurrences"></div>
          </div>
          <span class="repeat-end-count-label">times</span>
        </div>
        <div class="repeat-validation-message" data-repeat-end-error role="status" aria-live="polite"></div>
        <div class="modal-footer"><button type="button" class="btn-secondary" data-repeat-end-cancel>Cancel</button><button type="button" class="btn-primary" data-repeat-end-done>Done</button></div>
      </div>`;
    document.body.appendChild(modal);
    this.repeatEndModal = modal;
    this.repeatEndTypeWheel = modal.querySelector('[data-repeat-end-type-wheel]');
    this.repeatEndCountWheel = modal.querySelector('[data-repeat-end-count-wheel]');
    this.repeatEndDatePanel = modal.querySelector('[data-repeat-end-date]');
    this.repeatEndCountPanel = modal.querySelector('[data-repeat-end-count]');
    this.repeatEndCalendarGrid = modal.querySelector('[data-repeat-end-grid]');
    this.repeatEndMonthLabel = modal.querySelector('[data-repeat-end-month]');
    this.repeatEndError = modal.querySelector('[data-repeat-end-error]');

    this.populateWheel(this.repeatEndTypeWheel, ['Never', 'On date', 'After']);
    this.populateWheel(this.repeatEndCountWheel, Array.from({ length: 200 }, (_, i) => String(i + 1)));
    this.bindWheelEngine(this.repeatEndTypeWheel, '');
    this.bindWheelEngine(this.repeatEndCountWheel, '');
    this.bindRepeatEndWheel(this.repeatEndTypeWheel, index => this.setRepeatEndType(['never', 'date', 'count'][index]));
    this.bindRepeatEndWheel(this.repeatEndCountWheel, index => {
      if (this.repeatEndDraft) this.repeatEndDraft.count = index + 1;
    });

    row.addEventListener('click', () => this.openRepeatEndModal());
    modal.querySelector('[data-repeat-end-close]').addEventListener('click', () => this.closeRepeatEndModal());
    modal.querySelector('[data-repeat-end-cancel]').addEventListener('click', () => this.closeRepeatEndModal());
    modal.querySelector('[data-repeat-end-done]').addEventListener('click', () => this.submitRepeatEnd());
    modal.querySelector('[data-repeat-end-prev]').addEventListener('click', () => this.navigateRepeatEndMonth(-1));
    modal.querySelector('[data-repeat-end-next]').addEventListener('click', () => this.navigateRepeatEndMonth(1));
    modal.addEventListener('click', event => { if (event.target === modal) this.closeRepeatEndModal(); });
    modal.addEventListener('keydown', event => this.handleRepeatEndKeydown(event));
    this.ensureRepeatValidationMessage();
    this.renderRepeatEndRow();
  },

  bindRepeatEndWheel(wheel, onChange) {
    let timer = null;
    wheel.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => onChange(Math.max(0, Math.min(wheel._maxIndex, Math.round(wheel.scrollTop / this.ITEM_HEIGHT)))), 100);
    });
    wheel.addEventListener('click', event => {
      const item = event.target.closest('.wheel-item');
      if (!item) return;
      const items = [...wheel.querySelectorAll('.wheel-item')];
      const index = items.indexOf(item);
      if (index >= 0) onChange(index);
    });
  },

  renderRepeatEndRow() {
    if (!this.repeatEndsRow) return;
    this.draftRepeat = RepeatEngine.normalizeRepeatRule(this.draftRepeat);
    const active = this.draftRepeat.mode !== 'none';
    this.repeatEndsRow.hidden = !active;
    if (!active) return;
    const end = this.draftRepeat.end;
    let label = 'Never';
    if (end.type === 'date') label = end.date ? `On ${this.formatRepeatEndDate(end.date)}` : 'On date';
    if (end.type === 'count') label = `After ${end.count} times`;
    this.repeatEndsValue.textContent = label;
  },

  formatRepeatEndDate(value) {
    const date = RepeatEngine.parseDate(value);
    return date ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date) : '';
  },

  openRepeatEndModal() {
    this.draftRepeat = RepeatEngine.normalizeRepeatRule(this.draftRepeat);
    if (this.draftRepeat.mode === 'none') return;
    this.repeatEndSnapshot = RepeatEngine.clone(this.draftRepeat.end);
    this.repeatEndDraft = RepeatEngine.clone(this.draftRepeat.end);
    const typeIndex = { never: 0, date: 1, count: 2 }[this.repeatEndDraft.type] ?? 0;
    const count = Math.max(1, Math.min(200, Number(this.repeatEndDraft.count) || 1));
    this.repeatEndDraft.count = count;
    const baseDate = RepeatEngine.parseDate(this.repeatEndDraft.date || this.draftDate || RepeatEngine.today());
    this.repeatEndViewDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1, 12, 0, 0, 0);
    requestAnimationFrame(() => {
      this.scrollWheelToIndex(this.repeatEndTypeWheel, typeIndex, false, '');
      this.scrollWheelToIndex(this.repeatEndCountWheel, count - 1, false, '');
    });
    this.setRepeatEndType(this.repeatEndDraft.type);
    ModalFocusManager.open(this.repeatEndModal, {
      trigger: this.repeatEndsRow,
      initialFocus: this.repeatEndTypeWheel,
      fallbackFocus: this.repeatEndsRow
    });
  },

  closeRepeatEndModal() {
    ModalFocusManager.close(this.repeatEndModal, {
      fallbackFocus: this.repeatEndsRow
    });
    this.repeatEndDraft = null;
    this.repeatEndSnapshot = null;
    if (this.repeatEndError) this.repeatEndError.textContent = '';
  },

  handleRepeatEndKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeRepeatEndModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...this.repeatEndModal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])')]
      .filter(element => !element.disabled && element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  },

  setRepeatEndType(type) {
    if (!this.repeatEndDraft) return;
    this.repeatEndDraft.type = type;
    if (type === 'never') { this.repeatEndDraft.date = null; this.repeatEndDraft.count = null; }
    if (type === 'date') {
      this.repeatEndDraft.date ||= this.draftDate || RepeatEngine.today();
      this.repeatEndDraft.count = null;
    }
    if (type === 'count') { this.repeatEndDraft.date = null; this.repeatEndDraft.count ||= 1; }
    this.repeatEndDatePanel.hidden = type !== 'date';
    this.repeatEndCountPanel.hidden = type !== 'count';
    if (type === 'date') this.renderRepeatEndCalendar();
  },

  navigateRepeatEndMonth(delta) {
    const date = this.repeatEndViewDate || RepeatEngine.parseDate(RepeatEngine.today());
    this.repeatEndViewDate = new Date(date.getFullYear(), date.getMonth() + delta, 1, 12, 0, 0, 0);
    this.renderRepeatEndCalendar();
  },

  renderRepeatEndCalendar() {
    if (!this.repeatEndCalendarGrid || !this.repeatEndViewDate) return;
    const year = this.repeatEndViewDate.getFullYear();
    const month = this.repeatEndViewDate.getMonth();
    this.repeatEndMonthLabel.textContent = `${new Intl.DateTimeFormat('en-US', { month: 'long' }).format(this.repeatEndViewDate)} ${year}`;
    this.repeatEndCalendarGrid.innerHTML = '';
    const first = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const previous = new Date(year, month, 0).getDate();
    for (let i = first - 1; i >= 0; i--) this.repeatEndCalendarGrid.appendChild(this.createRepeatEndDay(year, month - 1, previous - i, true));
    for (let day = 1; day <= total; day++) this.repeatEndCalendarGrid.appendChild(this.createRepeatEndDay(year, month, day, false));
    for (let day = 1; day <= 42 - first - total; day++) this.repeatEndCalendarGrid.appendChild(this.createRepeatEndDay(year, month + 1, day, true));
  },

  createRepeatEndDay(year, month, day, outside) {
    const date = new Date(year, month, day, 12, 0, 0, 0);
    const value = RepeatEngine.formatDate(date);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `calendar-day${outside ? ' outside-month' : ''}${this.repeatEndDraft?.date === value ? ' selected' : ''}`;
    button.textContent = String(day);
    button.setAttribute('aria-selected', this.repeatEndDraft?.date === value ? 'true' : 'false');
    button.addEventListener('click', () => {
      this.repeatEndDraft.date = value;
      this.repeatEndViewDate = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
      this.renderRepeatEndCalendar();
    });
    return button;
  },

  submitRepeatEnd() {
    if (!this.repeatEndDraft) return;
    if (this.repeatEndDraft.type === 'date') {
      const start = this.draftDate || RepeatEngine.today();
      if (!this.repeatEndDraft.date || this.repeatEndDraft.date < start) {
        this.repeatEndError.textContent = 'Choose an end date on or after the task date.';
        return;
      }
    }
    this.draftRepeat = RepeatEngine.normalizeRepeatRule({ ...this.draftRepeat, end: this.repeatEndDraft });
    this.closeRepeatEndModal();
    this.renderRepeatEndRow();
    this.updateRepeatSummary();
  }
};
