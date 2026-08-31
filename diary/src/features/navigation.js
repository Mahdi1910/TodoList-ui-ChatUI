import { updateDateDisplay, setSimulatedDateOffset, simulatedDateOffset } from '../state.js';
import { showToast } from './toast.js';

export function activateDiaryView(targetId) {
    const targetView = document.getElementById(targetId);
    if (!targetView?.classList.contains('view-section')) return false;

    document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
    targetView.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.toggle('active', nav.getAttribute('data-target') === targetId);
    });

    const isSubview = targetView.classList.contains('subview-section');
    document.querySelector('.app-container')?.classList.toggle('hide-sidebar', isSubview);
    return true;
}

export function returnToSettingsHome() {
    return activateDiaryView('view-settings');
}

export function handleDiaryBack() {
    if (document.querySelector('.subview-section.active')) {
        returnToSettingsHome();
        return true;
    }
    return false;
}

export function initNavigation() {
    const toggleLeftSidebarBtn = document.getElementById('toggle-left-sidebar');
    const leftSidebar = document.getElementById('left-sidebar');
    if (toggleLeftSidebarBtn && leftSidebar) {
        toggleLeftSidebarBtn.addEventListener('click', () => leftSidebar.classList.toggle('collapsed'));
    }

    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', event => {
            event.preventDefault();
            const targetId = item.getAttribute('data-target');
            if (targetId) activateDiaryView(targetId);
        });
    });

    document.querySelectorAll('.category-link').forEach(link => {
        link.addEventListener('click', () => {
            const targetId = link.getAttribute('data-subview');
            if (targetId) activateDiaryView(targetId);
        });
    });

    document.querySelectorAll('.back-to-settings-btn').forEach(btn => {
        btn.addEventListener('click', returnToSettingsHome);
    });

    let versionClickCount = 0;
    const appVersionItem = document.getElementById('app-version-item');
    if (appVersionItem) {
        appVersionItem.addEventListener('click', () => {
            versionClickCount += 1;
            if (versionClickCount < 3) return;
            versionClickCount = 0;
            showToast('Opening the changelog');
            activateDiaryView('view-changelog');
        });
    }

    const prevBtn = document.getElementById('prev-day');
    const nextBtn = document.getElementById('next-day');
    updateDateDisplay();
    prevBtn?.addEventListener('click', () => {
        setSimulatedDateOffset(simulatedDateOffset - 1);
        updateDateDisplay();
    });
    nextBtn?.addEventListener('click', () => {
        if (simulatedDateOffset < 0) {
            setSimulatedDateOffset(simulatedDateOffset + 1);
            updateDateDisplay();
        }
    });
}

window.handleAndroidBack = handleDiaryBack;
