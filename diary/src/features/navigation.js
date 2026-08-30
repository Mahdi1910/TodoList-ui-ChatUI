import { updateDateDisplay, setSimulatedDateOffset, simulatedDateOffset } from '../state.js';
import { showToast } from './toast.js';

export function initNavigation() {
    // ================= LEFT SIDEBAR TOGGLE =================
    const toggleLeftSidebarBtn = document.getElementById('toggle-left-sidebar');
    const leftSidebar = document.getElementById('left-sidebar');

    if (toggleLeftSidebarBtn && leftSidebar) {
        toggleLeftSidebarBtn.addEventListener('click', () => {
            leftSidebar.classList.toggle('collapsed');
        });
    }

    // ================= NAVIGATION (SIDEBAR) =================
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            navItems.forEach(nav => nav.classList.remove('active'));
            views.forEach(view => view.classList.remove('active'));

            item.classList.add('active');

            const targetId = item.getAttribute('data-target');
            if (targetId) {
                const targetView = document.getElementById(targetId);
                if (targetView) targetView.classList.add('active');
                
                // Keep sidebar visible for settings. Sub-views will hide it.
                document.querySelector('.app-container')?.classList.remove('hide-sidebar');
            }
        });
    });

    // ================= SUB-PAGE NAVIGATION =================
    const categoryLinks = document.querySelectorAll('.category-link');
    categoryLinks.forEach(link => {
        link.addEventListener('click', () => {
             const targetId = link.getAttribute('data-subview');
             if (targetId) {
                 // Hide main settings
                 document.getElementById('view-settings').classList.remove('active');
                 // Show subview
                 const targetView = document.getElementById(targetId);
                 if (targetView) {
                     targetView.classList.add('active');
                 }
                 // Hide sidebar
                 document.querySelector('.app-container')?.classList.add('hide-sidebar');
             }
        });
    });

    const backToSettingsBtns = document.querySelectorAll('.back-to-settings-btn');
    backToSettingsBtns.forEach(btn => {
        btn.addEventListener('click', () => {
             // Hide all subviews
             const subviews = document.querySelectorAll('.subview-section');
             subviews.forEach(view => {
                 view.classList.remove('active');
             });
             
             // Show main settings
             const settingsView = document.getElementById('view-settings');
             if (settingsView) settingsView.classList.add('active');
             
             // Show sidebar again
             document.querySelector('.app-container')?.classList.remove('hide-sidebar');
        });
    });

    let versionClickCount = 0;
    const appVersionItem = document.getElementById('app-version-item');
    if (appVersionItem) {
        appVersionItem.addEventListener('click', () => {
            versionClickCount++;
            if (versionClickCount >= 3) {
                versionClickCount = 0; // reset
                showToast("Opening the changelog");
                // Hide main settings
                document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
                
                const changelogView = document.getElementById('view-changelog');
                if (changelogView) {
                    changelogView.classList.add('active');
                }
                
                // Hide sidebar for changelog
                document.querySelector('.app-container')?.classList.add('hide-sidebar');
            }
        });
    }

    // ================= DATE NAVIGATION (TODAY VIEW) =================
    const prevBtn = document.getElementById('prev-day');
    const nextBtn = document.getElementById('next-day');

    updateDateDisplay();

    if (prevBtn) prevBtn.addEventListener('click', () => { setSimulatedDateOffset(simulatedDateOffset - 1); updateDateDisplay(); });
    if (nextBtn) nextBtn.addEventListener('click', () => { if (simulatedDateOffset < 0) { setSimulatedDateOffset(simulatedDateOffset + 1); updateDateDisplay(); } });
}

window.handleAndroidBack = function() {
    // Check if any subview in the settings (or changelog) is active
    const activeSubviews = document.querySelectorAll('.subview-section.active');
    if (activeSubviews.length > 0) {
        // Hide all subviews
        activeSubviews.forEach(view => {
            view.classList.remove('active');
        });
        
        // Show main settings
        const settingsView = document.getElementById('view-settings');
        if (settingsView) settingsView.classList.add('active');
        
        // Show sidebar again
        document.querySelector('.app-container')?.classList.remove('hide-sidebar');
        
        return true; // We handled the back action successfully
    }
    return false; // Did not handle, let Android perform default back
};
