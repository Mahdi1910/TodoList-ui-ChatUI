import { TodoStorageMappers } from '../storage/mappers.js';
import { ModalFocusManager } from './modal-focus.js';
import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';

export const ScheduleTimeReminderMethods = {
  scrollWheelsToDraftTime() {
    if (!this.draftTime) this.draftTime = this.getCurrentTimeObj();

    const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

    const hIndex = Math.max(0, hours.indexOf(this.draftTime.hour));
    const mIndex = Math.max(0, minutes.indexOf(this.draftTime.minute));
    const pIndex = this.draftTime.period === 'PM' ? 1 : 0;

    requestAnimationFrame(() => {
      this.scrollWheelToIndex(this.wheelHour, hIndex, false, 'hour');
      this.scrollWheelToIndex(this.wheelMinute, mIndex, false, 'minute');
      this.scrollWheelToIndex(this.wheelPeriod, pIndex, false, 'period');
    });
  },

  resetTime() {
    this.draftTime = this.getCurrentTimeObj();
    this.draftReminders = [];
    this.scrollWheelsToDraftTime();
    this.updateReminderUI();
  },

  getCurrentTimeObj() {
    const now = new Date();
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const period = hours >= 12 ? 'PM' : 'AM';

    hours %= 12;
    if (hours === 0) hours = 12;
    const hourStr = String(hours).padStart(2, '0');

    return { hour: hourStr, minute: minutes, period };
  },

  parseTimeString(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return this.getCurrentTimeObj();
    const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!match) return this.getCurrentTimeObj();

    const hourStr = String(parseInt(match[1], 10)).padStart(2, '0');
    const minStr = match[2];
    const periodStr = match[3].toUpperCase();

    return { hour: hourStr, minute: minStr, period: periodStr };
  },

  getCustomReminders() {
    return AppState.getCustomReminderDefinitions()
      .map(definition => TodoStorageMappers.definitionToCustomReminder(definition))
      .filter(Boolean);
  },

  getReminderLabel(reminderId) {
    const definition = AppState.getReminderDefinition(reminderId);
    return definition?.label || reminderId;
  },

  initReminderSurfaces() {
    const candidates = [
      {
        name: 'time',
        trigger: this.btnReminderTrigger,
        menu: this.menuReminder,
        display: this.reminderValDisplay,
        customContainer: this.customRemindersContainer,
        customButton: this.btnOpenCustomReminder
      },
      {
        name: 'after',
        trigger: this.btnAfterReminderTrigger,
        menu: this.menuAfterReminder,
        display: this.afterReminderValDisplay,
        customContainer: this.afterCustomRemindersContainer,
        customButton: this.btnOpenCustomReminderAfter
      }
    ];
    this.reminderSurfaces = candidates.filter(surface => surface.trigger && surface.menu);
    this.activeReminderSurface = null;
    this.customReminderReturnTrigger = null;

    this.reminderSurfaces.forEach(surface => {
      surface.trigger.addEventListener('click', event => {
        event.stopPropagation();
        this.closeAfterTaskMenu?.();
        this.toggleReminderMenu(surface);
      });

      surface.menu.addEventListener('click', event => {
        const item = event.target.closest('.reminder-menu-item');
        if (!item || item === surface.customButton) return;

        const deleteButton = event.target.closest('.btn-del-custom-rem');
        if (deleteButton) {
          event.stopPropagation();
          this.deleteCustomReminder(deleteButton.dataset.id);
          return;
        }

        const key = item.dataset.reminder;
        if (!key) return;
        event.stopPropagation();
        this.toggleReminderSelection(key);
      });

      surface.customButton?.addEventListener('click', event => {
        event.stopPropagation();
        this.closeReminderMenu();
        this.openCustomReminderModal(surface.customButton);
      });
    });

    document.addEventListener('click', event => {
      if (!this.isAnyReminderMenuOpen()) return;
      const insideSurface = this.reminderSurfaces.some(surface =>
        surface.menu.contains(event.target) || surface.trigger.contains(event.target));
      if (!insideSurface) this.closeReminderMenu();
    });
  },

  toggleReminderMenu(surface = this.reminderSurfaces?.[0]) {
    if (!surface) return;
    if (surface.menu.classList.contains('open')) this.closeReminderMenu();
    else this.openReminderMenu(surface);
  },

  openReminderMenu(surface = this.reminderSurfaces?.[0]) {
    if (!surface) return;
    this.closeReminderMenu();
    this.activeReminderSurface = surface;
    this.renderReminderMenuContent(surface);
    surface.menu.classList.add('open');
    surface.trigger.setAttribute('aria-expanded', 'true');
  },

  closeReminderMenu() {
    (this.reminderSurfaces || []).forEach(surface => {
      surface.menu?.classList.remove('open');
      surface.trigger?.setAttribute('aria-expanded', 'false');
    });
    this.activeReminderSurface = null;
  },

  isAnyReminderMenuOpen() {
    return (this.reminderSurfaces || []).some(surface => surface.menu?.classList.contains('open'));
  },

  toggleReminderSelection(key) {
    if (key === 'none') {
      this.draftReminders = ['none'];
    } else {
      this.draftReminders = this.draftReminders.filter(item => item !== 'none');
      if (this.draftReminders.includes(key)) {
        this.draftReminders = this.draftReminders.filter(item => item !== key);
      } else {
        this.draftReminders.push(key);
      }
      if (this.draftReminders.length === 0) this.draftReminders = ['none'];
    }
    this.updateReminderUI();
    this.renderReminderMenuContent();
  },

  renderReminderMenuContent(targetSurface = null) {
    const surfaces = targetSurface ? [targetSurface] : (this.reminderSurfaces || []);
    surfaces.forEach(surface => {
      if (!surface?.menu) return;
      surface.menu.querySelectorAll('.reminder-menu-item').forEach(item => {
        const key = item.dataset.reminder;
        if (!key) return;
        const isSelected = this.draftReminders.includes(key);
        item.classList.toggle('selected', isSelected);
        item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
      });

      if (!surface.customContainer) return;
      surface.customContainer.innerHTML = '';
      this.getCustomReminders().forEach(custom => {
        const isSelected = this.draftReminders.includes(custom.id);
        const row = document.createElement('div');
        row.className = `reminder-menu-item${isSelected ? ' selected' : ''}`;
        row.dataset.reminder = custom.id;
        row.setAttribute('role', 'menuitemcheckbox');
        row.setAttribute('aria-checked', isSelected ? 'true' : 'false');

        const label = document.createElement('span');
        label.textContent = custom.label;
        const controls = document.createElement('div');
        Object.assign(controls.style, { display: 'flex', alignItems: 'center', gap: '6px' });
        const check = document.createElement('span');
        check.className = 'rem-check-icon';
        check.textContent = '✓';
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn-del-custom-rem';
        remove.dataset.id = custom.id;
        remove.title = 'Remove custom reminder';
        remove.setAttribute('aria-label', `Remove reminder ${custom.label}`);
        remove.textContent = '×';
        controls.append(check, remove);
        row.append(label, controls);
        surface.customContainer.appendChild(row);
      });
    });
  },

  updateReminderUI() {
    const value = !this.draftReminders.length || this.draftReminders.includes('none')
      ? 'None'
      : this.draftReminders.map(key => this.getReminderLabel(key)).join(', ');
    (this.reminderSurfaces || []).forEach(surface => {
      if (surface.display) surface.display.textContent = value;
    });
    // During early initialization, the legacy Time display can exist before
    // reminderSurfaces is built.
    if (!this.reminderSurfaces?.length && this.reminderValDisplay) this.reminderValDisplay.textContent = value;
  },

  async deleteCustomReminder(id) {
    try {
      const deleted = await AppDataService.deleteReminderDefinition(id);
      if (!deleted) return;
      this.draftReminders = this.draftReminders.filter(key => key !== id);
      if (!this.draftReminders.length) this.draftReminders = ['none'];
      this.updateReminderUI();
      this.renderReminderMenuContent();
    } catch (error) {
      AppPersistence.reportError('Could not delete this custom reminder.', error);
    }
  },

  openCustomReminderModal(trigger = this.activeReminderSurface?.customButton || this.btnOpenCustomReminder) {
    if (!this.customReminderModal) return;
    this.customReminderReturnTrigger = trigger?.isConnected ? trigger : this.btnOpenCustomReminder;
    this.draftCustomWheel = { min: 0, hr: 0, day: 0 };

    requestAnimationFrame(() => {
      this.scrollWheelToIndex(this.wheelCustomMin, 0, false, 'customMin');
      this.scrollWheelToIndex(this.wheelCustomHr, 0, false, 'customHr');
      this.scrollWheelToIndex(this.wheelCustomDay, 0, false, 'customDay');
    });

    ModalFocusManager.open(this.customReminderModal, {
      trigger: this.customReminderReturnTrigger,
      initialFocus: this.wheelCustomMin,
      fallbackFocus: this.customReminderReturnTrigger
    });
  },

  closeCustomReminderModal() {
    if (!this.customReminderModal) return;
    const fallback = this.customReminderReturnTrigger || this.btnOpenCustomReminder;
    ModalFocusManager.close(this.customReminderModal, { fallbackFocus: fallback });
    this.customReminderReturnTrigger = null;
  },

  async submitCustomReminder() {
    const { min, hr, day } = this.draftCustomWheel || { min: 0, hr: 0, day: 0 };
    if (min === 0 && hr === 0 && day === 0) return this.closeCustomReminderModal();

    const parts = [];
    if (day) parts.push(`${day}d`);
    if (hr) parts.push(`${hr}h`);
    if (min) parts.push(`${min}m`);
    const custom = {
      id: `custom-${day}d-${hr}h-${min}m`,
      label: `${parts.join(' ')} before`,
      min,
      hr,
      day
    };

    try {
      await AppDataService.saveReminderDefinition(custom);
      this.toggleReminderSelection(custom.id);
      this.closeCustomReminderModal();
    } catch (error) {
      AppPersistence.reportError('Could not save this custom reminder.', error);
    }
  }
};
