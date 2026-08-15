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

    hours = hours % 12;
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

  toggleReminderMenu() {
    if (this.menuReminder?.classList.contains('open')) {
      this.closeReminderMenu();
    } else {
      this.openReminderMenu();
    }
  },

  openReminderMenu() {
    this.renderReminderMenuContent();
    this.menuReminder?.classList.add('open');
    this.btnReminderTrigger?.setAttribute('aria-expanded', 'true');
  },

  closeReminderMenu() {
    this.menuReminder?.classList.remove('open');
    this.btnReminderTrigger?.setAttribute('aria-expanded', 'false');
  },

  toggleReminderSelection(key) {
    if (key === 'none') {
      this.draftReminders = ['none'];
    } else {
      this.draftReminders = this.draftReminders.filter(k => k !== 'none');
      if (this.draftReminders.includes(key)) {
        this.draftReminders = this.draftReminders.filter(k => k !== key);
      } else {
        this.draftReminders.push(key);
      }
      if (this.draftReminders.length === 0) {
        this.draftReminders = ['none'];
      }
    }
    this.updateReminderUI();
    this.renderReminderMenuContent();
  },

  renderReminderMenuContent() {
    if (!this.menuReminder) return;

    this.menuReminder.querySelectorAll('.reminder-menu-item').forEach(item => {
      const key = item.dataset.reminder;
      if (!key) return;
      const isSelected = this.draftReminders.includes(key);
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });

    if (this.customRemindersContainer) {
      this.customRemindersContainer.innerHTML = '';
      this.getCustomReminders().forEach(custom => {
        const isSelected = this.draftReminders.includes(custom.id);
        const div = document.createElement('div');
        div.className = `reminder-menu-item ${isSelected ? 'selected' : ''}`;
        div.dataset.reminder = custom.id;
        div.setAttribute('role', 'menuitemcheckbox');
        div.setAttribute('aria-checked', isSelected ? 'true' : 'false');
        div.innerHTML = `
          <span>${this.escapeText(custom.label)}</span>
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="rem-check-icon">✓</span>
            <button type="button" class="btn-del-custom-rem" data-id="${custom.id}" title="Remove custom reminder">&times;</button>
          </div>
        `;
        this.customRemindersContainer.appendChild(div);
      });
    }
  },

  updateReminderUI() {
    if (!this.reminderValDisplay) return;

    if (!this.draftReminders.length || this.draftReminders.includes('none')) {
      this.reminderValDisplay.textContent = 'None';
      return;
    }

    this.reminderValDisplay.textContent = this.draftReminders
      .map(key => this.getReminderLabel(key))
      .join(', ');
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

  openCustomReminderModal() {
    if (!this.customReminderModal) return;
    this.draftCustomWheel = { min: 0, hr: 0, day: 0 };

    requestAnimationFrame(() => {
      this.scrollWheelToIndex(this.wheelCustomMin, 0, false, 'customMin');
      this.scrollWheelToIndex(this.wheelCustomHr, 0, false, 'customHr');
      this.scrollWheelToIndex(this.wheelCustomDay, 0, false, 'customDay');
    });

    ModalFocusManager.open(this.customReminderModal, {
      trigger: this.btnOpenCustomReminder,
      initialFocus: this.wheelCustomMin,
      fallbackFocus: this.btnOpenCustomReminder
    });
  },

  closeCustomReminderModal() {
    if (!this.customReminderModal) return;
    ModalFocusManager.close(this.customReminderModal, {
      fallbackFocus: this.btnOpenCustomReminder
    });
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
