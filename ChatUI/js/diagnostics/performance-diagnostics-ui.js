/**
 * TEMPORARY PERFORMANCE DIAGNOSTICS — remove after profiling is complete.
 * Settings-only UI for Implementation Plan ID 12.
 */

import { copyTextToClipboard } from '../utils/dom.js';
import {
  PERFORMANCE_DIAGNOSTICS_EVENT,
  clearSavedPerformanceRuns,
  getPerformanceDiagnosticsState,
  setPerformanceDiagnosticsEnabled
} from './performance-diagnostics.js';
import { buildTemporaryPerformanceReport } from './performance-report.js';

let initialized = false;

function getElements() {
  return {
    toggle: document.getElementById('performance-diagnostics-toggle'),
    count: document.getElementById('performance-diagnostics-run-count'),
    status: document.getElementById('performance-diagnostics-status'),
    copyButton: document.getElementById('copy-performance-diagnostics-report-btn'),
    clearButton: document.getElementById('clear-performance-diagnostics-btn')
  };
}

function refreshUI() {
  const elements = getElements();
  const state = getPerformanceDiagnosticsState();

  if (elements.toggle) elements.toggle.checked = state.enabled;
  if (elements.count) elements.count.textContent = String(state.capturedRunCount);
  if (elements.status) {
    if (state.active) elements.status.textContent = 'Capturing current request…';
    else if (state.enabled) elements.status.textContent = 'Ready — send normal requests to capture measurements.';
    else elements.status.textContent = 'Off — previously captured runs remain saved until cleared.';
    elements.status.classList.toggle('is-active', state.active);
    elements.status.classList.toggle('is-enabled', state.enabled && !state.active);
  }
  if (elements.copyButton) elements.copyButton.disabled = state.capturedRunCount === 0;
  if (elements.clearButton) elements.clearButton.disabled = state.capturedRunCount === 0;
}

async function copyReport(button) {
  const report = buildTemporaryPerformanceReport();
  const copied = await copyTextToClipboard(report);
  if (!button) return;

  const previousText = button.textContent;
  button.textContent = copied ? 'Copied' : 'Copy failed';
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = previousText;
    refreshUI();
  }, 1600);
}

export function initPerformanceDiagnosticsUI() {
  if (initialized) {
    refreshUI();
    return;
  }
  initialized = true;

  const elements = getElements();

  elements.toggle?.addEventListener('change', event => {
    setPerformanceDiagnosticsEnabled(event.target.checked);
    refreshUI();
  });

  elements.copyButton?.addEventListener('click', () => {
    void copyReport(elements.copyButton);
  });

  elements.clearButton?.addEventListener('click', () => {
    const confirmed = window.confirm('Clear all captured temporary performance diagnostic runs?');
    if (!confirmed) return;
    clearSavedPerformanceRuns();
    refreshUI();
  });

  window.addEventListener(PERFORMANCE_DIAGNOSTICS_EVENT, refreshUI);
  refreshUI();
}
