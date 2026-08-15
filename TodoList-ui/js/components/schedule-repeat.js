import { ModalFocusManager } from './modal-focus.js';
import { RepeatEngine } from '../repeat/repeat-engine.js';

export const ScheduleRepeatMethods = {
  selectRepeatPreset(presetMode) {
    if (!this.draftRepeat) {
      this.draftRepeat = { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } };
    }
    this.draftRepeat.mode = presetMode;
    this.draftRepeat = RepeatEngine.normalizeRepeatRule(this.draftRepeat);
    if (presetMode !== 'none' && !this.draftDate) this.selectDate(RepeatEngine.today());
    this.clearRepeatValidationError?.();
    this.renderRepeatPresetList();
    this.updateRepeatSummary();
    this.renderRepeatEndRow?.();
  },

  renderRepeatPresetList() {
    if (!this.repeatOptionsList) return;
    const currentMode = this.draftRepeat?.mode || 'none';

    this.repeatOptionsList.querySelectorAll('.repeat-option-item').forEach(item => {
      const mode = item.dataset.repeatPreset;
      if (!mode) return;
      const isSelected = currentMode === mode;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    if (this.btnOpenCustomRepeat) {
      const isCustomSelected = currentMode === 'custom';
      this.btnOpenCustomRepeat.classList.toggle('selected', isCustomSelected);
      this.btnOpenCustomRepeat.setAttribute('aria-checked', isCustomSelected ? 'true' : 'false');
    }
  },

  updateRepeatSummary() {
    if (!this.repeatSummaryText) return;
    const mode = this.draftRepeat?.mode || 'none';

    if (mode === 'none') {
      this.repeatSummaryText.textContent = 'Does not repeat';
    } else if (mode === 'daily') {
      this.repeatSummaryText.textContent = 'Repeats daily';
    } else if (mode === 'weekly') {
      this.repeatSummaryText.textContent = 'Repeats weekly';
    } else if (mode === 'monthly') {
      this.repeatSummaryText.textContent = 'Repeats monthly';
    } else if (mode === 'yearly') {
      this.repeatSummaryText.textContent = 'Repeats yearly';
    } else if (mode === 'custom') {
      const custom = this.draftRepeat.custom || { interval: 1, unit: 'day' };
      const unitLabel = custom.interval === 1 ? custom.unit : `${custom.unit}s`;
      let text = `Repeats every ${custom.interval} ${unitLabel}`;

      if (custom.unit === 'week' && custom.weekdays?.length) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const selectedNames = custom.weekdays.sort((a,b)=>a-b).map(d => dayNames[d]).join(', ');
        text += ` on ${selectedNames}`;
      } else if (custom.unit === 'month' && custom.monthDays?.length) {
        const sortedDays = custom.monthDays.sort((a,b)=>a-b).map(d => `${d}${this.getOrdinalSuffix(d)}`).join(', ');
        text += ` on the ${sortedDays}`;
      } else if (custom.unit === 'year' && custom.yearDates && Object.keys(custom.yearDates).length) {
        let totalCount = 0;
        Object.values(custom.yearDates).forEach(arr => totalCount += arr.length);
        text += ` across ${totalCount} date${totalCount > 1 ? 's' : ''}`;
      }
      this.repeatSummaryText.textContent = text;
    }
  },

  getOrdinalSuffix(i) {
    const j = i % 10, k = i % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  },

  openCustomRepeatModal() {
    if (!this.customRepeatModal) return;

    this.customRepeatSnapshot = JSON.parse(JSON.stringify(
      this.draftRepeat || { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } }
    ));

    if (!this.draftRepeat) {
      this.draftRepeat = { mode: 'custom', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } };
    }
    this.draftRepeat.mode = 'custom';
    if (!this.draftRepeat.custom) {
      this.draftRepeat.custom = { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} };
    }

    const custom = this.draftRepeat.custom;
    const intervalIndex = Math.max(0, custom.interval - 1);
    const units = ['day', 'week', 'month', 'year'];
    const unitIndex = Math.max(0, units.indexOf(custom.unit));

    requestAnimationFrame(() => {
      this.scrollWheelToIndex(this.wheelRepeatLabel, 0, false, '');
      this.scrollWheelToIndex(this.wheelRepeatInterval, intervalIndex, false, 'repeatInterval');
      this.scrollWheelToIndex(this.wheelRepeatUnit, unitIndex, false, 'repeatUnit');
    });

    this.updateCustomRepeatSubviews(custom.unit);
    ModalFocusManager.open(this.customRepeatModal, {
      trigger: this.btnOpenCustomRepeat,
      initialFocus: this.wheelRepeatInterval,
      fallbackFocus: this.btnOpenCustomRepeat
    });
  },

  closeCustomRepeatModal(commit = false) {
    if (!this.customRepeatModal) return;
    if (!commit && this.customRepeatSnapshot) {
      this.draftRepeat = JSON.parse(JSON.stringify(this.customRepeatSnapshot));
    }
    this.customRepeatSnapshot = null;
    ModalFocusManager.close(this.customRepeatModal, {
      fallbackFocus: this.btnOpenCustomRepeat
    });
    this.renderRepeatPresetList();
    this.updateRepeatSummary();
  },

  submitCustomRepeat() {
    const candidate = RepeatEngine.normalizeRepeatRule({ ...this.draftRepeat, mode: 'custom' });
    const check = RepeatEngine.validateRepeatRule(candidate);
    if (!check.valid) return this.showRepeatValidationError(check.message);
    this.clearRepeatValidationError();
    this.draftRepeat = check.repeat;
    if (!this.draftDate) this.selectDate(RepeatEngine.today());
    this.closeCustomRepeatModal(true);
    this.draftRepeat = RepeatEngine.normalizeRepeatRule(this.draftRepeat);
    this.renderRepeatEndRow?.();
    return true;
  },

  updateCustomRepeatSubviews(unit) {
    if (this.subviewRepeatWeek) this.subviewRepeatWeek.style.display = unit === 'week' ? 'block' : 'none';
    if (this.subviewRepeatMonth) this.subviewRepeatMonth.style.display = unit === 'month' ? 'block' : 'none';
    if (this.subviewRepeatYear) this.subviewRepeatYear.style.display = unit === 'year' ? 'block' : 'none';

    if (unit === 'week') {
      this.renderCustomRepeatWeekdays();
    } else if (unit === 'month') {
      this.renderCustomRepeatMonthGrid();
    } else if (unit === 'year') {
      this.repeatYearViewMonthIndex = (this.currentViewDate || new Date()).getMonth();
      this.renderCustomRepeatYearGrid();
    }
  },

  renderCustomRepeatWeekdays() {
    if (!this.subviewRepeatWeek) return;
    const selectedDays = this.draftRepeat.custom.weekdays || [];

    this.subviewRepeatWeek.querySelectorAll('.weekday-circle-btn').forEach(btn => {
      const day = parseInt(btn.dataset.day, 10);
      const isSelected = selectedDays.includes(day);
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
  },

  toggleCustomRepeatWeekday(day) {
    if (!this.draftRepeat.custom.weekdays) this.draftRepeat.custom.weekdays = [];
    const arr = this.draftRepeat.custom.weekdays;

    if (arr.includes(day)) {
      this.draftRepeat.custom.weekdays = arr.filter(d => d !== day);
    } else {
      this.draftRepeat.custom.weekdays.push(day);
    }
    this.renderCustomRepeatWeekdays();
  },

};
