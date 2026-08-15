const scriptPromises = new Map();
const stylePromises = new Map();
const ownedStyles = new Map();

const CHAT_DEPENDENCIES = Object.freeze({
  lucide: 'https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js',
  marked: 'https://cdn.jsdelivr.net/npm/marked@15.0.6/marked.min.js',
  highlight: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  highlightCss: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css'
});

function shellStyleAnchor() {
  return document.getElementById('shell-stylesheet');
}

export function loadScriptOnce(src, { globalName = '', id = '' } = {}) {
  if (globalName && globalThis[globalName]) return Promise.resolve(globalThis[globalName]);
  if (scriptPromises.has(src)) return scriptPromises.get(src);

  const promise = new Promise((resolve, reject) => {
    const existing = id ? document.getElementById(id) : document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true' || (globalName && globalThis[globalName])) {
        resolve(globalName ? globalThis[globalName] : true);
        return;
      }
      existing.addEventListener('load', () => resolve(globalName ? globalThis[globalName] : true), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    if (id) script.id = id;
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      if (globalName && !globalThis[globalName]) {
        reject(new Error(`${globalName} did not initialize after loading ${src}`));
        return;
      }
      resolve(globalName ? globalThis[globalName] : true);
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });

  scriptPromises.set(src, promise);
  return promise;
}

export function loadStylesheetOnce(href, { id = '', owner = 'shared', beforeShell = true } = {}) {
  const cacheKey = `${owner}:${href}`;
  if (stylePromises.has(cacheKey)) return stylePromises.get(cacheKey);

  const promise = new Promise((resolve, reject) => {
    let link = id ? document.getElementById(id) : null;
    if (!link) {
      link = document.querySelector(`link[data-module-style-owner="${owner}"][href="${href}"]`);
    }
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.moduleStyleOwner = owner;
      if (id) link.id = id;
      const anchor = beforeShell ? shellStyleAnchor() : null;
      if (anchor?.parentNode) anchor.parentNode.insertBefore(link, anchor);
      else document.head.appendChild(link);
    }

    if (!ownedStyles.has(owner)) ownedStyles.set(owner, new Set());
    ownedStyles.get(owner).add(link);

    if (link.sheet) {
      resolve(link);
      return;
    }
    link.addEventListener('load', () => resolve(link), { once: true });
    link.addEventListener('error', () => reject(new Error(`Failed to load stylesheet ${href}`)), { once: true });
  });

  stylePromises.set(cacheKey, promise);
  return promise;
}

export function unloadOwnedStyles(owner) {
  const links = ownedStyles.get(owner);
  if (!links) return;
  links.forEach(link => link.remove());
  ownedStyles.delete(owner);
  for (const key of [...stylePromises.keys()]) {
    if (key.startsWith(`${owner}:`)) stylePromises.delete(key);
  }
}

export async function ensureChatDependencies() {
  await Promise.all([
    loadScriptOnce(CHAT_DEPENDENCIES.lucide, { globalName: 'lucide', id: 'chatui-lucide-script' }),
    loadScriptOnce(CHAT_DEPENDENCIES.marked, { globalName: 'marked', id: 'chatui-marked-script' }),
    loadScriptOnce(CHAT_DEPENDENCIES.highlight, { globalName: 'hljs', id: 'chatui-highlight-script' }),
    loadStylesheetOnce(CHAT_DEPENDENCIES.highlightCss, { owner: 'chatui', id: 'chatui-highlight-style' })
  ]);
}

export async function loadChatStyles() {
  const styles = [
    '/ChatUI/css/main.css',
    '/ChatUI/css/sidebar.css',
    '/ChatUI/css/chat.css',
    '/ChatUI/css/components.css',
    '/ChatUI/css/animations.css',
    '/ChatUI/css/responsive.css',
    '/ChatUI/css/integration.css'
  ];
  await Promise.all(styles.map(href => loadStylesheetOnce(href, { owner: 'chatui' })));
}

export async function loadTodoStyles() {
  const styles = [
    '/TodoList-ui/css/variables.css',
    '/TodoList-ui/css/layout/app-shell.css',
    '/TodoList-ui/css/layout/sidebar-layout.css',
    '/TodoList-ui/css/layout/workspace-layout.css',
    '/TodoList-ui/css/components/task-cards.css',
    '/TodoList-ui/css/components/task-subtasks.css',
    '/TodoList-ui/css/components/task-drag.css',
    '/TodoList-ui/css/components/task-groups.css',
    '/TodoList-ui/css/components/task-kanban.css',
    '/TodoList-ui/css/components/modal-controls.css',
    '/TodoList-ui/css/components/project-tags.css',
    '/TodoList-ui/css/components/quick-task.css',
    '/TodoList-ui/css/components/schedule-date.css',
    '/TodoList-ui/css/components/schedule-wheels.css',
    '/TodoList-ui/css/components/schedule-reminders.css',
    '/TodoList-ui/css/components/schedule-repeat.css',
    '/TodoList-ui/css/components/schedule-repeat-end.css',
    '/TodoList-ui/css/integration.css'
  ];
  await Promise.all(styles.map(href => loadStylesheetOnce(href, { owner: 'todo' })));
}

export function unloadModuleStyles(appId) {
  unloadOwnedStyles(appId === 'chat' ? 'chatui' : appId);
}
