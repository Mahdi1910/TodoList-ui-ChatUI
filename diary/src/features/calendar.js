import { setSimulatedDateOffset, updateDateDisplay } from '../state.js';
import { getActiveDates } from './database.js';

export function initCalendar() {
    const grid = document.getElementById('cal-grid');
    const title = document.getElementById('cal-month-title');
    const prevBtn = document.getElementById('cal-prev-month');
    const nextBtn = document.getElementById('cal-next-month');
    
    if (!grid || !title) return;

    let currentDate = new Date();

    async function renderCalendar() {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        // Update Title
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        title.textContent = `${monthNames[month]} ${year}`;

        // Clear grid except day names
        Array.from(grid.children).forEach(child => {
            if (!child.classList.contains('cal-day-name')) {
                child.remove();
            }
        });

        const firstDay = new Date(year, month, 1).getDay();
        const firstDayIndex = firstDay === 0 ? 6 : firstDay - 1;

        // Fetch active dates from Database
        const activeDatesStr = await getActiveDates();
        
        for (let i = 0; i < 42; i++) {
            const dayDiv = document.createElement('div');
            dayDiv.classList.add('cal-day');

            // Calculate the date for this cell
            const cellDate = new Date(year, month, 1 - firstDayIndex + i);
            const d = cellDate.getDate();
            const m = cellDate.getMonth();
            const y = cellDate.getFullYear();
            
            dayDiv.textContent = d;

            if (m !== month) {
                dayDiv.classList.add('other-month');
            }

            // Check if today
            const today = new Date();
            if (d === today.getDate() && m === today.getMonth() && y === today.getFullYear()) {
                dayDiv.classList.add('today');
            }

            // Check if has entries in DB
            const cellDateStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            if (activeDatesStr.includes(cellDateStr)) {
                dayDiv.classList.add('has-entry');
                dayDiv.title = `View entries`;
            }

            // Clicking ANY day sets the app's simulated date state
            dayDiv.addEventListener('click', () => {
                const clickedDate = new Date(y, m, d);
                const today2 = new Date();
                today2.setHours(0, 0, 0, 0);
                
                const timeDiff = clickedDate.getTime() - today2.getTime();
                const offsetDays = Math.round(timeDiff / (1000 * 3600 * 24));
                
                setSimulatedDateOffset(offsetDays);
                updateDateDisplay();

                // Switch back to the main feed view
                const todayNav = document.getElementById('nav-today');
                if (todayNav) {
                    todayNav.click();
                }
            });

            grid.appendChild(dayDiv);
        }
    }



    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
        });
    }

    // Refresh calendar whenever it comes into view so it catches new entries
    const navCalendar = document.getElementById('nav-calendar');
    if (navCalendar) {
        navCalendar.addEventListener('click', () => {
            renderCalendar();
        });
    }

    // Initial render
    renderCalendar();
}
