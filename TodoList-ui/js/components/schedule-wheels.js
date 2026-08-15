export const ScheduleWheelMethods = {
  initWheels() {
    const hours = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
    const periods = ['AM', 'PM'];

    this.populateWheel(this.wheelHour, hours);
    this.populateWheel(this.wheelMinute, minutes);
    this.populateWheel(this.wheelPeriod, periods);

    [
      { wheel: this.wheelHour, type: 'hour' },
      { wheel: this.wheelMinute, type: 'minute' },
      { wheel: this.wheelPeriod, type: 'period' }
    ].forEach(({ wheel, type }) => {
      this.bindWheelEngine(wheel, type);
    });

    // Custom Reminder Wheels (Minutes 0-60, Hours 0-23, Days 0-60)
    const customMins = Array.from({ length: 61 }, (_, i) => String(i));
    const customHrs = Array.from({ length: 24 }, (_, i) => String(i));
    const customDays = Array.from({ length: 61 }, (_, i) => String(i));

    this.populateWheel(this.wheelCustomMin, customMins);
    this.populateWheel(this.wheelCustomHr, customHrs);
    this.populateWheel(this.wheelCustomDay, customDays);

    [
      { wheel: this.wheelCustomMin, type: 'customMin' },
      { wheel: this.wheelCustomHr, type: 'customHr' },
      { wheel: this.wheelCustomDay, type: 'customDay' }
    ].forEach(({ wheel, type }) => {
      this.bindWheelEngine(wheel, type);
    });

    // Custom Repeat Wheels (Every + Number 1-99 + Unit day/week/month/year)
    this.populateWheel(this.wheelRepeatLabel, ['Every']);
    const repeatIntervals = Array.from({ length: 99 }, (_, i) => String(i + 1));
    const repeatUnits = ['day', 'week', 'month', 'year'];

    this.populateWheel(this.wheelRepeatInterval, repeatIntervals);
    this.populateWheel(this.wheelRepeatUnit, repeatUnits);

    [
      { wheel: this.wheelRepeatInterval, type: 'repeatInterval' },
      { wheel: this.wheelRepeatUnit, type: 'repeatUnit' }
    ].forEach(({ wheel, type }) => {
      this.bindWheelEngine(wheel, type);
    });
  },

  populateWheel(wheel, items) {
    if (!wheel) return;
    wheel.innerHTML = '';

    const topPad = document.createElement('div');
    topPad.className = 'wheel-padding';
    topPad.style.height = `${((this.VISIBLE_ITEMS - 1) / 2) * this.ITEM_HEIGHT}px`;
    wheel.appendChild(topPad);

    items.forEach(value => {
      const item = document.createElement('div');
      item.className = 'wheel-item';
      item.textContent = value;
      item.dataset.value = value;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      wheel.appendChild(item);
    });

    const botPad = document.createElement('div');
    botPad.className = 'wheel-padding';
    botPad.style.height = `${((this.VISIBLE_ITEMS - 1) / 2) * this.ITEM_HEIGHT}px`;
    wheel.appendChild(botPad);

    wheel._maxIndex = items.length - 1;
  },

  bindWheelEngine(wheel, type) {
    if (!wheel) return;

    let accumulatedDelta = 0;

    wheel.addEventListener('wheel', e => {
      e.preventDefault();
      accumulatedDelta += e.deltaY;

      if (Math.abs(accumulatedDelta) < 25) return;

      const direction = accumulatedDelta > 0 ? 1 : -1;
      accumulatedDelta = 0;

      const currentIndex = Math.round(wheel.scrollTop / this.ITEM_HEIGHT);
      const newIndex = Math.max(0, Math.min(wheel._maxIndex, currentIndex + direction));
      this.scrollWheelToIndex(wheel, newIndex, true, type);
    }, { passive: false });

    let isTouch = false;
    let startY = 0;
    let startScrollTop = 0;

    wheel.addEventListener('touchstart', e => {
      isTouch = true;
      startY = e.touches[0].clientY;
      startScrollTop = wheel.scrollTop;
    }, { passive: true });

    wheel.addEventListener('touchmove', e => {
      if (!isTouch) return;
      const deltaY = startY - e.touches[0].clientY;
      wheel.scrollTop = startScrollTop + deltaY;
    }, { passive: true });

    wheel.addEventListener('touchend', () => {
      isTouch = false;
      requestAnimationFrame(() => {
        const index = Math.round(wheel.scrollTop / this.ITEM_HEIGHT);
        this.scrollWheelToIndex(wheel, index, true, type);
      });
    });

    wheel.addEventListener('click', e => {
      const item = e.target.closest('.wheel-item');
      if (!item) return;
      const items = [...wheel.querySelectorAll('.wheel-item')];
      const index = items.indexOf(item);
      if (index !== -1) {
        this.scrollWheelToIndex(wheel, index, true, type);
      }
    });

    wheel.addEventListener('scroll', () => {
      clearTimeout(wheel._scrollTimeout);
      wheel._scrollTimeout = setTimeout(() => {
        const index = Math.round(wheel.scrollTop / this.ITEM_HEIGHT);
        this.updateWheelSelectionUI(wheel, index, type);
      }, 80);
    });
  },

  scrollWheelToIndex(wheel, index, smooth = true, type = '') {
    if (!wheel) return;
    const clamped = Math.max(0, Math.min(wheel._maxIndex, index));
    wheel.scrollTo({
      top: clamped * this.ITEM_HEIGHT,
      behavior: smooth ? 'smooth' : 'auto'
    });
    this.updateWheelSelectionUI(wheel, clamped, type);
  },

  updateWheelSelectionUI(wheel, index, type = '') {
    if (!wheel) return;
    const items = [...wheel.querySelectorAll('.wheel-item')];
    items.forEach((item, i) => {
      const isSelected = i === index;
      item.classList.toggle('selected', isSelected);
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    const selectedItem = items[index];
    if (selectedItem && type) {
      if (type === 'customMin' || type === 'customHr' || type === 'customDay') {
        if (!this.draftCustomWheel) this.draftCustomWheel = { min: 0, hr: 0, day: 0 };
        if (type === 'customMin') this.draftCustomWheel.min = parseInt(selectedItem.dataset.value, 10);
        if (type === 'customHr') this.draftCustomWheel.hr = parseInt(selectedItem.dataset.value, 10);
        if (type === 'customDay') this.draftCustomWheel.day = parseInt(selectedItem.dataset.value, 10);
      } else if (type === 'repeatInterval' || type === 'repeatUnit') {
        if (!this.draftRepeat) this.draftRepeat = { mode: 'none', custom: { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} } };
        if (!this.draftRepeat.custom) this.draftRepeat.custom = { interval: 1, unit: 'day', weekdays: [], monthDays: [], yearDates: {} };

        if (type === 'repeatInterval') {
          this.draftRepeat.custom.interval = parseInt(selectedItem.dataset.value, 10);
        } else if (type === 'repeatUnit') {
          const oldUnit = this.draftRepeat.custom.unit;
          const newUnit = selectedItem.dataset.value;
          this.draftRepeat.custom.unit = newUnit;
          if (oldUnit !== newUnit) {
            this.updateCustomRepeatSubviews(newUnit);
          }
        }
      } else {
        if (!this.draftTime) this.draftTime = this.getCurrentTimeObj();
        this.draftTime[type] = selectedItem.dataset.value;
      }
    }
  },

};
