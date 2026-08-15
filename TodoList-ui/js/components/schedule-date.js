export const ScheduleDateMethods = {
  navigateMonth(delta) {
    const year = this.currentViewDate.getFullYear();
    const month = this.currentViewDate.getMonth();
    this.currentViewDate = new Date(year, month + delta, 1);
    this.renderCalendar();
  },

  renderCalendar() {
    if (!this.gridEl || !this.monthYearEl) return;

    const year = this.currentViewDate.getFullYear();
    const month = this.currentViewDate.getMonth();

    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(this.currentViewDate);
    this.monthYearEl.textContent = `${monthName} ${year}`;

    this.gridEl.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const todayStr = this.formatDateStr(new Date());

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const dateObj = new Date(year, month - 1, dayNum);
      const dayStr = this.formatDateStr(dateObj);
      this.gridEl.appendChild(this.createDayCell(dayNum, dayStr, true, todayStr));
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const dateObj = new Date(year, month, dayNum);
      const dayStr = this.formatDateStr(dateObj);
      this.gridEl.appendChild(this.createDayCell(dayNum, dayStr, false, todayStr));
    }

    const totalRendered = firstDayIndex + daysInMonth;
    const remainingCells = 42 - totalRendered;
    for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
      const dateObj = new Date(year, month + 1, dayNum);
      const dayStr = this.formatDateStr(dateObj);
      this.gridEl.appendChild(this.createDayCell(dayNum, dayStr, true, todayStr));
    }
  },

  createDayCell(dayNum, dateStr, isOutside, todayStr) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calendar-day';
    btn.textContent = dayNum;
    btn.dataset.date = dateStr;

    if (isOutside) btn.classList.add('outside-month');
    if (dateStr === todayStr) btn.classList.add('today');
    if (this.draftDate && dateStr === this.draftDate) btn.classList.add('selected');

    btn.setAttribute('role', 'gridcell');
    btn.setAttribute('aria-selected', this.draftDate && dateStr === this.draftDate ? 'true' : 'false');
    btn.setAttribute('aria-label', `${dateStr}${dateStr === todayStr ? ' (Today)' : ''}`);

    btn.addEventListener('click', () => this.selectDate(dateStr));
    return btn;
  },

  selectDate(dateStr) {
    this.draftDate = dateStr;
    if (dateStr) {
      const parts = dateStr.split('-').map(Number);
      this.currentViewDate = new Date(parts[0], parts[1] - 1, parts[2]);
    }
    this.renderCalendar();
  },

  parseLocalDateStr(dateStr) {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0); // Noon local time prevents DST/timezone shifts
  },

  handleQuickAction(actionType) {
    const today = new Date();

    if (actionType === 'today') {
      this.selectDate(this.formatDateStr(today));
    } else if (actionType === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);
      this.selectDate(this.formatDateStr(tomorrow));
    } else if (actionType === 'nextWeek') {
      const nextWeek = new Date(today);
      nextWeek.setDate(today.getDate() + 7);
      this.selectDate(this.formatDateStr(nextWeek));
    } else if (actionType === 'nextMonth') {
      const year = today.getFullYear();
      const month = today.getMonth();
      const day = today.getDate();

      const targetMonth = (month + 1) % 12;
      const targetYear = month === 11 ? year + 1 : year;

      const maxDaysInTarget = new Date(targetYear, targetMonth + 1, 0).getDate();
      const clampedDay = Math.min(day, maxDaysInTarget);

      const targetDate = new Date(targetYear, targetMonth, clampedDay);
      this.selectDate(this.formatDateStr(targetDate));
    } else if (actionType === 'clear') {
      this.draftDate = null;
      this.renderCalendar();
    }
  },

  /**
   * TIME WHEEL ENGINE (Delta-Normalized Snap Scrolling)
   */
  formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

};
