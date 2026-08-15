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

    // Reminder Menu Trigger & Multi-select
    this.btnReminderTrigger?.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleReminderMenu();
    });

    this.menuReminder?.addEventListener('click', e => {
      const item = e.target.closest('.reminder-menu-item');
      if (!item || item.id === 'btn-open-custom-reminder') return;

      const delBtn = e.target.closest('.btn-del-custom-rem');
      if (delBtn) {
        e.stopPropagation();
        this.deleteCustomReminder(delBtn.dataset.id);
        return;
      }

      this.toggleReminderSelection(item.dataset.reminder);
    });

    this.btnOpenCustomReminder?.addEventListener('click', e => {
      e.stopPropagation();
      this.closeReminderMenu();
      this.openCustomReminderModal();
    });

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

    // Custom Reminder Modal Actions
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

    document.addEventListener('click', e => {
      if (this.menuReminder?.classList.contains('open') && !this.menuReminder.contains(e.target) && e.target !== this.btnReminderTrigger) {
        this.closeReminderMenu();
      }
    });

    this.modalEl?.addEventListener('keydown', e => this.handleKeydown(e));
  },

  switchTab(tabName) {
    if (tabName === this.activeTab) return;
    this.activeTab = tabName;

    this.tabDate.classList.toggle('active', tabName === 'date');
    this.tabDate.setAttribute('aria-selected', tabName === 'date' ? 'true' : 'false');

    this.tabTime.classList.toggle('active', tabName === 'time');
    this.tabTime.setAttribute('aria-selected', tabName === 'time' ? 'true' : 'false');

    this.tabRepeat.classList.toggle('active', tabName === 'repeat');
    this.tabRepeat.setAttribute('aria-selected', tabName === 'repeat' ? 'true' : 'false');

    this.panelDate.classList.toggle('active', tabName === 'date');
    this.panelTime.classList.toggle('active', tabName === 'time');
    this.panelRepeat.classList.toggle('active', tabName === 'repeat');

    if (tabName === 'time') {
      if (!this.draftTime) {
        this.draftTime = this.getCurrentTimeObj();
      }
      this.scrollWheelsToDraftTime();
    } else if (tabName === 'repeat') {
      this.renderRepeatPresetList();
      this.updateRepeatSummary();
    }
  },
};
