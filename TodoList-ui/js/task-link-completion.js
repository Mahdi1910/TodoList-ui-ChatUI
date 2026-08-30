import { TaskLinks } from './task-links.js';

export function installTaskLinkCompletion(service, state) {
  if (!service || !state || service.__taskLinkCompletionInstalled) return false;
  if (typeof service.toggleTaskStatus !== 'function') throw new Error('Todo task completion service is unavailable.');

  const originalToggleTaskStatus = service.toggleTaskStatus.bind(service);

  service.toggleTaskStatus = async function toggleTaskStatusWithLinks(taskId) {
    const source = state.getTask(taskId);
    if (!source) return originalToggleTaskStatus(taskId);

    // Completion links synchronize completion only. Uncompleting one historical
    // occurrence must not revive linked tasks or prior repeat occurrences.
    if (source.completed) return originalToggleTaskStatus(taskId);

    // Snapshot only the task occurrences that exist before completion starts.
    // Repeat can create future occurrences with new IDs; they must never join the
    // cascade that completed the current occurrence.
    const snapshotTasks = (state.tasks || []).map(task => ({
      id: task.id,
      title: String(task.title || ''),
      completed: Boolean(task.completed)
    }));
    const snapshotById = new Map(snapshotTasks.map(task => [task.id, task]));
    const queue = [taskId];
    const queued = new Set(queue);
    const observedCompleted = new Set();
    let primaryResult = null;

    const discoverLinksFromNewCompletions = () => {
      for (const snapshot of snapshotTasks) {
        if (snapshot.completed || observedCompleted.has(snapshot.id)) continue;
        const current = state.getTask(snapshot.id);
        if (!current?.completed) continue;
        observedCompleted.add(snapshot.id);
        for (const linkedId of TaskLinks.activeLinkedComponentIds(snapshot.id, snapshotTasks)) {
          const linkedSnapshot = snapshotById.get(linkedId);
          if (!linkedSnapshot || linkedSnapshot.completed || queued.has(linkedId)) continue;
          queued.add(linkedId);
          queue.push(linkedId);
        }
      }
    };

    while (queue.length) {
      const currentId = queue.shift();
      const current = state.getTask(currentId);
      if (!current || current.completed) {
        discoverLinksFromNewCompletions();
        continue;
      }

      try {
        const result = await originalToggleTaskStatus(currentId);
        if (currentId === taskId) primaryResult = result;
      } catch (error) {
        if (currentId === taskId) throw error;
        // The initiating task has already committed at this point. Do not report
        // the whole user action as failed and make the UI pretend it rolled back.
        // Keep processing other links and expose the rare partial failure for
        // diagnostics instead.
        console.error(`Could not complete linked task ${currentId}.`, error);
      }
      discoverLinksFromNewCompletions();
    }

    return primaryResult;
  };

  service.__taskLinkCompletionInstalled = true;
  return true;
}
