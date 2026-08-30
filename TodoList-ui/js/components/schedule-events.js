export const ScheduleEventMethods = {
  bindEvents() {
    // Tabs
    this.tabDate?.addEventListener('click', () => this.switchTab('date'));
    this.tabTime?.addEventListener('click', () => this.switchTab('time'));
    this.tabRepeat?.addEventListener('click', () => this.switchTab('repeat'));

    // Calendar Month Nav
    this.btnCalPrev?.addEventListener('click', () => this.navigateMonth(-1));
    this.btnCalNext?.addEventListener('click', () => this.navigateMonth(1));

    // Date Quick Actions
    this.btnQuickToday?.addEventListener('click', () => this.handleQuickAction('today'));
    this.btnQuickTomorrow?.addEventListener('click', () => this.handleQuickAction('tomorrow'));
    this.btnQuickNextWeek?.addEventListener('click', () => this.handleQuickAction('nextWeek'));
    this.btnQuickNextMonth?.addEventListener('click', () => this.handleQuickAction('nextMonth'));
    this.btnQuickClear?.addEventListener('click', () => this.handleQuickAction('clear'));

    // Reset Time Action
    this.btnResetTime?.addEventListener('click', () => this.resetTime());

    // Repeat Presets List Selection
    this.repeatOptionsList?.addEventListener('click', e => {
      const item = e.target.closest('.repeat-option-item');
      if (!item) return;
      if (item.id === 'btn-open-custom-repeat') {
        this.openCustomRepeatModal();
      } else {
        this.selectRepeatPreset(item.dataset.repeatPreset);
      }
    });

    // Custom Repeat Dialog Events
    this.btnCloseCustomRepeat?.addEventListener('click', () => this.closeCustomRepeatModal());
    this.btnCustomRepCancel?.addEventListener('click', () => this.closeCustomRepeatModal());
    this.customRepeatForm?.addEventListener('submit', e => {
      e.preventDefault();
      this.submitCustomRepeat();
    });

    // Custom Repeat Weekday Circle Toggle
    this.subviewRepeatWeek?.addEventListener('click', e => {
      const btn = e.target.closest('.weekday-circle-btn');
      if (!btn) return;
      const day = parseInt(btn.dataset.day, 10);
      this.toggleCustomRepeatWeekday(day);
    });

    // Custom Repeat Year Navigation
    this.btnRepeatYearPrev?.addEventListener('click', () => this.navigateRepeatYearMonth(-1));
    this.btnRepeatYearNext?.addEventListener('click', () => this.navigateRepeatYearMonth(1));

    // Custom Reminder Modal Actions. The Time and After reminder surfaces
    // themselves are bound centrally by initReminderSurfaces().
    this.btnCloseCustomReminder?.addEventListener('click', () => this.closeCustomReminderModal());
    this.btnCustomRemCancel?.addEventListener('click', () => this.closeCustomReminderModal());
    this.customReminderForm?.addEventListener('submit', e => {
      e.preventDefault();
      this.submitCustomReminder();
    });

    // Schedule Modal Footer Actions
    this.btnCancel?.addEventListener('click', () => this.close(true));
    this.btnApply?.addEventListener('click', () => this.apply());

    this.modalEl?.addEventListener('click', e => {
      if (e.target === this.modalEl) this.close(true);
    });

    this.modalEl?.addEventListener('keydown', e => this.handleKeydown(e));
  },

  switchTab(tabName) {
    if (!['date', 'time', 'repeat', 'after'].includes(tabName)) return;
    if (tabName === this.activeTab) {
      if (tabName === 'after') this.renderAfterPanel?.();
      return;
    }
    this.closeReminderMenu?.();
    this.closeAfterTaskMenu?.();
    this.activeTab = tabName;

    const tabs = {
      date: this.tabDate,
      time: this.tabTime,
      repeat: this.tabRepeat,
      after: this.tabAfter
    };
    const panels = {
      date: this.panelDate,
      time: this.panelTime,
      repeat: this.panelRepeat,
      after: this.panelAfter
    };
    Object.entries(tabs).forEach(([name, tab]) => {
      tab?.classList.toggle('active', name === tabName);
      tab?.setAttribute('aria-selected', name === tabName ? 'true' : 'false');
    });
    Object.entries(panels).forEach(([name, panel]) => {
      panel?.classList.toggle('active', name === tabName);
    });

    if (tabName === 'time') {
      if (!this.draftTime) this.draftTime = this.getCurrentTimeObj();
      this.scrollWheelsToDraftTime();
    } else if (tabName === 'repeat') {
      this.renderRepeatPresetList();
      this.updateRepeatSummary();
    } else if (tabName === 'after') {
      this.renderAfterPanel?.();
    }
  },
};
