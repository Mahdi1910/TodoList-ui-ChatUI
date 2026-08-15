/**
 * activity-renderer.js - DOM rendering for ordered assistant activity timelines.
 */

import { renderMarkdown } from './markdown.js';
import { getToolDisplayTitle } from './activity-timeline.js';

const STATUS_LABELS = {
  requested: 'Requested',
  running: 'Running…',
  completed: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted'
};

const STATUS_ICONS = {
  requested: 'circle-dashed',
  running: 'loader-circle',
  completed: 'check',
  failed: 'triangle-alert',
  interrupted: 'square'
};

function getExpansionState(container) {
  if (!(container._activityExpansionState instanceof Map)) {
    container._activityExpansionState = new Map();
  }
  return container._activityExpansionState;
}

function renderJsonBlock(value) {
  const pre = document.createElement('pre');
  pre.className = 'activity-json-block';
  if (value == null) pre.textContent = 'No details returned.';
  else if (typeof value === 'string') pre.textContent = value;
  else {
    try { pre.textContent = JSON.stringify(value, null, 2); }
    catch (_) { pre.textContent = String(value); }
  }
  return pre;
}

function appendDetailSection(details, label, value, truncated = false) {
  const section = document.createElement('div');
  section.className = 'activity-detail-section';
  const heading = document.createElement('div');
  heading.className = 'activity-detail-label';
  heading.textContent = label;
  section.append(heading, renderJsonBlock(value));
  if (truncated) {
    const note = document.createElement('div');
    note.className = 'activity-result-truncated';
    note.textContent = `${label} preview truncated for chat history.`;
    section.appendChild(note);
  }
  details.appendChild(section);
}

function createToggleCard(container, activity, options) {
  const state = getExpansionState(container);
  const defaultExpanded = options.defaultExpanded === true;
  const expanded = state.has(activity.id) ? state.get(activity.id) : defaultExpanded;

  const item = document.createElement('div');
  item.className = options.className;
  item.dataset.activityId = activity.id;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'activity-toggle';
  button.setAttribute('aria-expanded', String(expanded));

  const left = document.createElement('span');
  left.className = 'activity-header-main';
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', options.icon);
  icon.className = `activity-icon ${options.iconClass || ''}`;
  const title = document.createElement('span');
  title.className = 'activity-title';
  title.textContent = options.title;
  left.append(icon, title);

  const right = document.createElement('span');
  right.className = 'activity-header-status';
  const status = document.createElement('span');
  status.className = 'activity-status';
  status.textContent = options.status;
  const chevron = document.createElement('i');
  chevron.setAttribute('data-lucide', 'chevron-down');
  chevron.className = 'activity-chevron';
  right.append(status, chevron);

  button.append(left, right);

  const details = document.createElement('div');
  details.className = `activity-details ${expanded ? '' : 'hidden'}`.trim();
  options.renderDetails(details);

  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-expanded') !== 'true';
    state.set(activity.id, next);
    button.setAttribute('aria-expanded', String(next));
    details.classList.toggle('hidden', !next);
  });

  item.append(button, details);
  return item;
}

function renderThinkingActivity(container, activity, message, isFinal) {
  const text = String(message.thinking || '').slice(activity.start, activity.end);
  const active = activity.status === 'running';
  const durationMs = activity.completedAt && activity.startedAt
    ? Math.max(0, activity.completedAt - activity.startedAt)
    : 0;
  let statusText = 'Completed';
  let icon = 'sparkles';
  let iconClass = '';
  if (active) {
    statusText = 'In progress';
    icon = 'loader-circle';
    iconClass = 'is-spinning';
  } else if (activity.status === 'failed') {
    statusText = 'Failed';
    icon = 'triangle-alert';
  } else if (activity.status === 'interrupted') {
    statusText = 'Interrupted';
    icon = 'square';
  } else if (durationMs >= 1000) {
    statusText = `${(durationMs / 1000).toFixed(1)}s`;
  }

  return createToggleCard(container, activity, {
    className: `activity-item activity-item-thinking ${active ? 'is-active' : ''}`,
    icon,
    iconClass,
    title: 'Thinking',
    status: statusText,
    defaultExpanded: active,
    renderDetails(details) {
      const content = document.createElement('div');
      content.className = 'activity-thinking-content';
      content.innerHTML = text ? renderMarkdown(text, { isFinal: isFinal && !active }) : '';
      details.appendChild(content);
    }
  });
}

function renderTextActivity(activity, message, isFinal) {
  const item = document.createElement('div');
  item.className = 'activity-item activity-item-text';
  item.dataset.activityId = activity.id;
  const text = String(message.content || '').slice(activity.start, activity.end);
  if (text) item.innerHTML = renderMarkdown(text, { isFinal: isFinal && activity.status !== 'running' });
  if (!isFinal && activity.status === 'running') {
    const cursor = document.createElement('span');
    cursor.className = 'streaming-cursor';
    item.appendChild(cursor);
  }
  return item;
}

function renderToolActivity(container, activity) {
  const status = activity.status || 'completed';
  return createToggleCard(container, activity, {
    className: `activity-item activity-item-tool activity-tool-${status}`,
    icon: STATUS_ICONS[status] || 'wrench',
    iconClass: status === 'running' ? 'is-spinning' : '',
    title: getToolDisplayTitle(activity),
    status: STATUS_LABELS[status] || status,
    defaultExpanded: false,
    renderDetails(details) {
      const toolSection = document.createElement('div');
      toolSection.className = 'activity-detail-section';
      const label = document.createElement('div');
      label.className = 'activity-detail-label';
      label.textContent = 'Tool';
      const name = document.createElement('code');
      name.className = 'activity-tool-name';
      name.textContent = activity.name || activity.toolType || 'tool';
      toolSection.append(label, name);
      details.appendChild(toolSection);

      appendDetailSection(details, 'Arguments', activity.args || {}, activity.argsTruncated === true);
      if (activity.resultPreview != null || activity.status === 'completed' || activity.status === 'failed') {
        appendDetailSection(details, 'Result', activity.resultPreview, activity.resultTruncated === true);
      }
      if (activity.error) appendDetailSection(details, 'Error', activity.error, false);
    }
  });
}

function createGeneratingPlaceholder() {
  const placeholder = document.createElement('div');
  placeholder.className = 'activity-generating-placeholder';
  placeholder.setAttribute('role', 'status');
  placeholder.setAttribute('aria-live', 'polite');
  placeholder.setAttribute('aria-label', 'Assistant is generating a response');

  const spinner = document.createElement('i');
  spinner.setAttribute('data-lucide', 'loader-circle');
  spinner.setAttribute('aria-hidden', 'true');
  spinner.className = 'activity-generating-spinner';

  const label = document.createElement('span');
  label.className = 'activity-generating-label';
  label.textContent = 'Generating...';

  placeholder.append(spinner, label);
  return placeholder;
}

export function renderActivityTimeline(container, message, { isFinal = true } = {}) {
  if (!container) return;
  const timeline = Array.isArray(message?.activityTimeline) ? message.activityTimeline : [];
  const waitingForFirstActivity =
    message?.role === 'assistant' &&
    message?.status === 'generating' &&
    !isFinal &&
    timeline.length === 0 &&
    !String(message?.content || '').trim() &&
    !String(message?.thinking || '').trim();

  container.classList.add('assistant-activity-timeline');
  container.replaceChildren();

  if (waitingForFirstActivity) {
    container.appendChild(createGeneratingPlaceholder());
  } else if (timeline.length === 0 && message?.content) {
    const fallback = document.createElement('div');
    fallback.className = 'activity-item activity-item-text';
    fallback.innerHTML = renderMarkdown(message.content, { isFinal });
    container.appendChild(fallback);
  } else {
    timeline.forEach(activity => {
      if (activity.type === 'thinking') container.appendChild(renderThinkingActivity(container, activity, message, isFinal));
      else if (activity.type === 'text') container.appendChild(renderTextActivity(activity, message, isFinal));
      else if (activity.type === 'tool') container.appendChild(renderToolActivity(container, activity));
    });
  }

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}
