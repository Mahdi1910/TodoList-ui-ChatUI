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

    // Snapshot the current active linked component before any task completes.
    // Repeat completion can create a new occurrence with a new task ID; that new
    // occurrence must not be pulled into this same completion cascade.
    const linkedIds = TaskLinks.activeLinkedComponentIds(taskId, state.tasks);
    const orderedIds = [taskId, ...linkedIds.filter(id => id !== taskId)];

    const primaryResult = await originalToggleTaskStatus(taskId);
    for (const linkedId of orderedIds.slice(1)) {
      const linked = state.getTask(linkedId);
      if (!linked || linked.completed) continue;
      try {
        await originalToggleTaskStatus(linkedId);
      } catch (error) {
        // The initiating task has already committed at this point. Do not report
        // the whole user action as failed and make the UI pretend it rolled back.
        // Keep processing other links and expose the rare partial failure for
        // diagnostics instead.
        console.error(`Could not complete linked task ${linkedId}.`, error);
      }
    }
    return primaryResult;
  };

  service.__taskLinkCompletionInstalled = true;
  return true;
}
