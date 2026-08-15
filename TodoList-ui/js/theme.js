import { AppState } from './state.js';

let configuredThemeRoot = null;

function resolveThemeRoot() {
  return configuredThemeRoot?.isConnected
    ? configuredThemeRoot
    : document.querySelector('.todo-app') || document.getElementById('app') || document.documentElement;
}

export const ThemeManager = {
  setRoot(root = null) {
    configuredThemeRoot = root || null;
    if (AppState.theme) resolveThemeRoot().setAttribute('data-theme', AppState.theme);
  },

  clearRoot(root = null) {
    if (!root || configuredThemeRoot === root) configuredThemeRoot = null;
  },

  init(root = null) {
    if (root) this.setRoot(root);
    const savedTheme = localStorage.getItem('theme') || 'dark';
    this.setTheme(savedTheme);
  },

  setTheme(themeName) {
    AppState.theme = themeName;
    resolveThemeRoot().setAttribute('data-theme', themeName);
    localStorage.setItem('theme', themeName);

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) themeToggle.checked = themeName === 'light';
  },

  toggleTheme() {
    const nextTheme = AppState.theme === 'dark' ? 'light' : 'dark';
    this.setTheme(nextTheme);
  }
};
