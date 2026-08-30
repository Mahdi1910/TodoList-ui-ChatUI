export const TaskLinks = (() => {
  const TASK_ID_PREFIX = 'task-';
  const TOKEN_PREFIX = '[[task:';
  const TOKEN_SUFFIX = ']]';
  const TOKEN_PATTERN_SOURCE = String.raw`\[\[task:(task-[^\]\r\n]{1,512})\]\]`;

  function tokenPattern() {
    return new RegExp(TOKEN_PATTERN_SOURCE, 'g');
  }

  function normalizeTaskId(value) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id.startsWith(TASK_ID_PREFIX) || id.length > 512 || /[\]\r\n]/.test(id)) return null;
    return id;
  }

  function tokenFor(taskId) {
    const id = normalizeTaskId(taskId);
    if (!id) throw new Error('Task link ID is invalid.');
    return `${TOKEN_PREFIX}${id}${TOKEN_SUFFIX}`;
  }

  function parseTitle(title = '') {
    const text = String(title ?? '');
    const pattern = tokenPattern();
    const segments = [];
    let cursor = 0;
    let match;

    while ((match = pattern.exec(text))) {
      if (match.index > cursor) {
        segments.push({ type: 'text', text: text.slice(cursor, match.index) });
      }
      const taskId = normalizeTaskId(match[1]);
      if (taskId) {
        segments.push({ type: 'task', taskId, raw: match[0] });
      } else {
        segments.push({ type: 'text', text: match[0] });
      }
      cursor = match.index + match[0].length;
    }

    if (cursor < text.length) segments.push({ type: 'text', text: text.slice(cursor) });
    if (!segments.length && text) segments.push({ type: 'text', text });
    return segments;
  }

  function extractTaskIds(title = '') {
    const output = [];
    const seen = new Set();
    parseTitle(title).forEach(segment => {
      if (segment.type !== 'task' || seen.has(segment.taskId)) return;
      seen.add(segment.taskId);
      output.push(segment.taskId);
    });
    return output;
  }

  function stripTokens(title = '') {
    const parts = parseTitle(title)
      .filter(segment => segment.type === 'text')
      .map(segment => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return parts;
  }

  function taskMap(tasks = []) {
    return new Map((tasks || []).filter(Boolean).map(task => [task.id, task]));
  }

  function labelForTask(task, tasks = []) {
    if (!task) return 'Missing task';
    const plain = stripTokens(task.title);
    if (plain) return plain;

    // A title may intentionally be only a task token. Resolve one level so the
    // card still shows a useful human label without recursively expanding a
    // potentially cyclic graph of task titles.
    const byId = taskMap(tasks);
    const referenceId = extractTaskIds(task.title)[0] || null;
    const referenced = referenceId ? byId.get(referenceId) : null;
    const referencedPlain = referenced ? stripTokens(referenced.title) : '';
    return referencedPlain || 'Task';
  }

  function displayTitleText(title = '', tasks = []) {
    const byId = taskMap(tasks);
    return parseTitle(title).map(segment => {
      if (segment.type === 'text') return segment.text;
      return labelForTask(byId.get(segment.taskId), tasks);
    }).join('');
  }

  function containsSelfReference(title, taskId) {
    const id = normalizeTaskId(taskId);
    return Boolean(id && extractTaskIds(title).includes(id));
  }

  function adjacency(tasks = []) {
    const rows = (tasks || []).filter(task => task && typeof task.id === 'string');
    const byId = taskMap(rows);
    const graph = new Map(rows.map(task => [task.id, new Set()]));

    rows.forEach(task => {
      extractTaskIds(task.title).forEach(referenceId => {
        if (referenceId === task.id || !byId.has(referenceId)) return;
        graph.get(task.id)?.add(referenceId);
        graph.get(referenceId)?.add(task.id);
      });
    });
    return { graph, byId };
  }

  function activeLinkedComponentIds(taskId, tasks = []) {
    const { graph, byId } = adjacency(tasks);
    const start = byId.get(taskId);
    if (!start || start.completed) return start ? [start.id] : [];

    const output = [];
    const queue = [taskId];
    const seen = new Set();
    while (queue.length) {
      const id = queue.shift();
      if (seen.has(id)) continue;
      seen.add(id);
      const task = byId.get(id);
      if (!task || task.completed) continue;
      output.push(id);
      for (const linkedId of graph.get(id) || []) {
        const linked = byId.get(linkedId);
        if (linked && !linked.completed && !seen.has(linkedId)) queue.push(linkedId);
      }
    }
    return output;
  }

  return {
    TASK_ID_PREFIX,
    TOKEN_PREFIX,
    TOKEN_SUFFIX,
    normalizeTaskId,
    tokenFor,
    parseTitle,
    extractTaskIds,
    stripTokens,
    labelForTask,
    displayTitleText,
    containsSelfReference,
    activeLinkedComponentIds
  };
})();
