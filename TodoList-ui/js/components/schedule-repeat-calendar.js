export const ScheduleRepeatCalendarMethods = {
  renderCustomRepeatMonthGrid() {
    if (!this.repeatMonthDaysGrid || !this.repeatMonthGridTitle) return;

    const baseDate = this.draftDate ? this.parseLocalDateStr(this.draftDate) : new Date();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();

    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(baseDate);
    this.repeatMonthGridTitle.textContent = `${monthName} ${year}`;

    this.repeatMonthDaysGrid.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const selectedDays = this.draftRepeat.custom.monthDays || [];

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day outside-month';
      btn.textContent = dayNum;
      btn.disabled = true;
      this.repeatMonthDaysGrid.appendChild(btn);
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day';
      btn.textContent = dayNum;
      const isSelected = selectedDays.includes(dayNum);
      if (isSelected) btn.classList.add('selected');
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

      btn.addEventListener('click', () => {
        if (!this.draftRepeat.custom.monthDays) this.draftRepeat.custom.monthDays = [];
        const arr = this.draftRepeat.custom.monthDays;
        if (arr.includes(dayNum)) {
          this.draftRepeat.custom.monthDays = arr.filter(d => d !== dayNum);
        } else {
          this.draftRepeat.custom.monthDays.push(dayNum);
        }
        this.renderCustomRepeatMonthGrid();
      });

      this.repeatMonthDaysGrid.appendChild(btn);
    }

    const totalRendered = firstDayIndex + daysInMonth;
    const remainingCells = 42 - totalRendered;
    for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day outside-month';
      btn.textContent = dayNum;
      btn.disabled = true;
      this.repeatMonthDaysGrid.appendChild(btn);
    }
  },

  navigateRepeatYearMonth(delta) {
    let currentM = this.repeatYearViewMonthIndex ?? (new Date()).getMonth();
    currentM += delta;
    if (currentM < 0) currentM = 0; // Jan bound
    if (currentM > 11) currentM = 11; // Dec bound
    this.repeatYearViewMonthIndex = currentM;
    this.renderCustomRepeatYearGrid();
  },

  renderCustomRepeatYearGrid() {
    if (!this.repeatYearDaysGrid || !this.repeatYearGridTitle) return;

    const baseDate = this.draftDate ? this.parseLocalDateStr(this.draftDate) : new Date();
    const year = baseDate.getFullYear();
    const month = this.repeatYearViewMonthIndex ?? baseDate.getMonth();

    const targetDate = new Date(year, month, 1);
    const monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(targetDate);
    this.repeatYearGridTitle.textContent = `${monthName} ${year}`;

    if (this.btnRepeatYearPrev) this.btnRepeatYearPrev.disabled = month === 0;
    if (this.btnRepeatYearNext) this.btnRepeatYearNext.disabled = month === 11;

    this.repeatYearDaysGrid.innerHTML = '';

    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    if (!this.draftRepeat.custom.yearDates) this.draftRepeat.custom.yearDates = {};
    const yearDatesObj = this.draftRepeat.custom.yearDates;
    const monthSelectedDays = yearDatesObj[month] || [];

    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const dayNum = daysInPrevMonth - i;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day outside-month';
      btn.textContent = dayNum;
      btn.disabled = true;
      this.repeatYearDaysGrid.appendChild(btn);
    }

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day';
      btn.textContent = dayNum;
      const isSelected = monthSelectedDays.includes(dayNum);
      if (isSelected) btn.classList.add('selected');
      btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

      btn.addEventListener('click', () => {
        if (!yearDatesObj[month]) yearDatesObj[month] = [];
        const arr = yearDatesObj[month];
        if (arr.includes(dayNum)) {
          yearDatesObj[month] = arr.filter(d => d !== dayNum);
          if (!yearDatesObj[month].length) delete yearDatesObj[month];
        } else {
          yearDatesObj[month].push(dayNum);
        }
        this.renderCustomRepeatYearGrid();
      });

      this.repeatYearDaysGrid.appendChild(btn);
    }

    const totalRendered = firstDayIndex + daysInMonth;
    const remainingCells = 42 - totalRendered;
    for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'calendar-day outside-month';
      btn.textContent = dayNum;
      btn.disabled = true;
      this.repeatYearDaysGrid.appendChild(btn);
    }
  },

};
