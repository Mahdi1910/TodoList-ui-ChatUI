import { ModalFocusManager } from './modal-focus.js';
import { RepeatEngine } from '../repeat/repeat-engine.js';
import { ScheduleEventMethods } from './schedule-events.js';
import { ScheduleDateMethods } from './schedule-date.js';
import { ScheduleWheelMethods } from './schedule-wheels.js';
import { ScheduleTimeReminderMethods } from './schedule-time-reminders.js';
import { ScheduleRepeatMethods } from './schedule-repeat.js';
import { ScheduleRepeatCalendarMethods } from './schedule-repeat-calendar.js';
import { ScheduleRepeatEndMethods } from './schedule-repeat-end.js';
import { ScheduleRepeatValidationMethods } from './schedule-repeat-validation.js';

/**
 * Schedule Component Manager
 * Modal lifecycle, draft state (Date, Time, Reminders), calendar rendering engine,
 * 3-wheel time picker, upward reminder context menu, custom reminder dialog,
 * accessibility focus trap, and Apply/Cancel callbacks.
 */

const ScheduleCore = {
  activeTab: 'date', // 'date' | 'time' | 'repeat'
  currentViewDate: new Date(),
  draftDate: null, // "YYYY-MM-DD" string or null
  draftTime: null, // { hour: "10", minute: "30", period: "PM" } or null
  draftReminders: ['on_time'], // Array of reminder keys e.g. ["none"], ["on_time"], ["5_min"]
  draftRepeat: { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } },
  onApplyCallback: null,
  lastFocusedElement: null,
  afterCloseCallback: null,

  ITEM_HEIGHT: 40,
  VISIBLE_ITEMS: 5,

  init() {
    this.modalEl = document.getElementById('schedule-modal');
    this.monthYearEl = document.getElementById('calendar-month-year');
    this.gridEl = document.getElementById('calendar-days-grid');
    this.btnCalPrev = document.getElementById('btn-cal-prev');
    this.btnCalNext = document.getElementById('btn-cal-next');

    // Quick Date Actions
    this.btnQuickToday = document.getElementById('btn-sched-today');
    this.btnQuickTomorrow = document.getElementById('btn-sched-tomorrow');
    this.btnQuickNextWeek = document.getElementById('btn-sched-next-week');
    this.btnQuickNextMonth = document.getElementById('btn-sched-next-month');
    this.btnQuickClear = document.getElementById('btn-sched-clear');

    // Tabs
    this.tabDate = document.getElementById('tab-sched-date');
    this.tabTime = document.getElementById('tab-sched-time');
    this.tabRepeat = document.getElementById('tab-sched-repeat');
    this.panelDate = document.getElementById('panel-sched-date');
    this.panelTime = document.getElementById('panel-sched-time');
    this.panelRepeat = document.getElementById('panel-sched-repeat');

    // Repeat Presets & Summary
    this.repeatOptionsList = document.querySelector('.repeat-options-list');
    this.btnOpenCustomRepeat = document.getElementById('btn-open-custom-repeat');
    this.repeatSummaryText = document.getElementById('repeat-summary-text');

    // Custom Repeat Modal & Wheels
    this.customRepeatModal = document.getElementById('custom-repeat-modal');
    this.customRepeatForm = document.getElementById('custom-repeat-form');
    this.wheelRepeatLabel = document.getElementById('wheel-repeat-label');
    this.wheelRepeatInterval = document.getElementById('wheel-repeat-interval');
    this.wheelRepeatUnit = document.getElementById('wheel-repeat-unit');
    this.subviewRepeatWeek = document.getElementById('subview-repeat-week');
    this.subviewRepeatMonth = document.getElementById('subview-repeat-month');
    this.subviewRepeatYear = document.getElementById('subview-repeat-year');
    this.repeatMonthGridTitle = document.getElementById('repeat-month-grid-title');
    this.repeatMonthDaysGrid = document.getElementById('repeat-month-days-grid');
    this.repeatYearGridTitle = document.getElementById('repeat-year-grid-title');
    this.repeatYearDaysGrid = document.getElementById('repeat-year-days-grid');
    this.btnRepeatYearPrev = document.getElementById('btn-repeat-year-prev');
    this.btnRepeatYearNext = document.getElementById('btn-repeat-year-next');
    this.btnCloseCustomRepeat = document.getElementById('btn-close-custom-repeat');
    this.btnCustomRepCancel = document.getElementById('btn-custom-rep-cancel');

    // Time Wheels
    this.wheelHour = document.getElementById('wheel-hour');
    this.wheelMinute = document.getElementById('wheel-minute');
    this.wheelPeriod = document.getElementById('wheel-period');
    this.btnResetTime = document.getElementById('btn-sched-reset-time');

    // Reminders
    this.btnReminderTrigger = document.getElementById('btn-sched-reminder-trigger');
    this.menuReminder = document.getElementById('menu-sched-reminder');
    this.reminderValDisplay = document.getElementById('reminder-value-display');
    this.customRemindersContainer = document.getElementById('custom-reminders-list');
    this.btnOpenCustomReminder = document.getElementById('btn-open-custom-reminder');

    // Custom Reminder Modal
    this.customReminderModal = document.getElementById('custom-reminder-modal');
    this.customReminderForm = document.getElementById('custom-reminder-form');
    this.wheelCustomMin = document.getElementById('wheel-custom-min');
    this.wheelCustomHr = document.getElementById('wheel-custom-hr');
    this.wheelCustomDay = document.getElementById('wheel-custom-day');
    this.btnCloseCustomReminder = document.getElementById('btn-close-custom-reminder');
    this.btnCustomRemCancel = document.getElementById('btn-custom-rem-cancel');

    // Bottom Actions
    this.btnCancel = document.getElementById('btn-sched-cancel');
    this.btnApply = document.getElementById('btn-sched-apply');

    this.initWheels();
    this.bindEvents();
  },

  open(initialDueDateStr = null, initialTimeStr = null, initialReminders = null, initialRepeat = null, onApply = null, focusPolicy = null) {
    const returnFocusTarget = focusPolicy?.returnFocusTarget;
    this.lastFocusedElement = returnFocusTarget?.isConnected ? returnFocusTarget : document.activeElement;
    this.afterCloseCallback = typeof focusPolicy?.afterClose === 'function' ? focusPolicy.afterClose : null;
    this.draftDate = initialDueDateStr || null;
    this.onApplyCallback = onApply;

    if (initialTimeStr) {
      this.draftTime = this.parseTimeString(initialTimeStr);
    } else {
      this.draftTime = null;
    }

    if (Array.isArray(initialReminders) && initialReminders.length) {
      this.draftReminders = [...initialReminders];
    } else {
      this.draftReminders = ['on_time'];
    }

    if (initialRepeat && typeof initialRepeat === 'object') {
      this.draftRepeat = JSON.parse(JSON.stringify(initialRepeat));
    } else {
      this.draftRepeat = { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } };
    }
    this.draftRepeat = RepeatEngine.normalizeRepeatRule(this.draftRepeat);

    // Set view date to selected date or current date
    if (this.draftDate) {
      const parts = this.draftDate.split('-').map(Number);
      this.currentViewDate = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      this.currentViewDate = new Date();
    }

    this.switchTab('date');
    this.renderCalendar();
    this.updateReminderUI();
    this.renderRepeatEndRow?.();

    ModalFocusManager.open(this.modalEl, {
      trigger: this.lastFocusedElement,
      initialFocus: () => this.gridEl?.querySelector('.calendar-day.selected') ||
                          this.gridEl?.querySelector('.calendar-day.today') ||
                          this.btnQuickToday,
      fallbackFocus: this.lastFocusedElement
    });
  },

  close(discard = true) {
    if (discard) {
      this.draftDate = null;
      this.draftTime = null;
      this.draftReminders = ['on_time'];
      this.draftRepeat = { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } };
    }
    this.closeReminderMenu();
    const afterClose = this.afterCloseCallback;
    this.afterCloseCallback = null;
    const closed = ModalFocusManager.close(this.modalEl, {
      fallbackFocus: this.lastFocusedElement
    });
    this.lastFocusedElement = null;
    if (closed && typeof afterClose === 'function') afterClose();
  },

  apply() {
    this.draftRepeat = RepeatEngine.normalizeRepeatRule(this.draftRepeat);
    if (this.draftRepeat.mode !== 'none' && !this.draftDate) this.selectDate(RepeatEngine.today());
    const check = RepeatEngine.validateRepeatRule(this.draftRepeat);
    if (!check.valid) {
      this.switchTab('repeat');
      return this.showRepeatValidationError(check.message);
    }
    if (check.repeat.end.type === 'date') {
      const start = this.draftDate || RepeatEngine.today();
      if (check.repeat.end.date < start) {
        this.switchTab('repeat');
        return this.showRepeatValidationError('Repeat end date cannot be before the task date.');
      }
    }
    this.clearRepeatValidationError();
    this.draftRepeat = check.repeat;

    if (typeof this.onApplyCallback === 'function') {
      const formattedTime = this.draftTime
        ? `${this.draftTime.hour}:${this.draftTime.minute} ${this.draftTime.period}`
        : null;

      // If time is set without a specific date, automatically assign today's date
      let finalDate = this.draftDate;
      if (formattedTime && !finalDate) {
        finalDate = this.formatDateStr(new Date());
      }

      this.onApplyCallback({
        dueDate: finalDate,
        dueTime: formattedTime,
        reminders: [...this.draftReminders],
        repeat: JSON.parse(JSON.stringify(this.draftRepeat))
      });
    }
    this.close(false);
    return true;
  },

  escapeText(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.textContent;
  },

  handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (this.customRepeatModal?.classList.contains('active')) {
        this.closeCustomRepeatModal();
      } else if (this.customReminderModal?.classList.contains('active')) {
        this.closeCustomReminderModal();
      } else if (this.menuReminder?.classList.contains('open')) {
        this.closeReminderMenu();
      } else {
        this.close(true);
      }
      return;
    }

    if (e.key !== 'Tab') return;

    let activeModal = this.modalEl;
    if (this.customRepeatModal?.classList.contains('active')) {
      activeModal = this.customRepeatModal;
    } else if (this.customReminderModal?.classList.contains('active')) {
      activeModal = this.customReminderModal;
    }

    const focusable = [...activeModal.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);

    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable.at(-1);

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

};

export const ScheduleComponent = {
  ...ScheduleCore,
  ...ScheduleEventMethods,
  ...ScheduleDateMethods,
  ...ScheduleWheelMethods,
  ...ScheduleTimeReminderMethods,
  ...ScheduleRepeatMethods,
  ...ScheduleRepeatCalendarMethods,
  ...ScheduleRepeatEndMethods,
  ...ScheduleRepeatValidationMethods
};

window.ScheduleComponent = ScheduleComponent;
