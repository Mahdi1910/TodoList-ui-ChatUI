import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';
import { TodoMutationCoordinator } from '../tools/todo-mutation-coordinator.js';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function activeRepeat(task) {
  return Boolean(task?.repeat && task.repeat.mode !== 'none');
}

export class TaskSelectionActions {
  constructor(controller) {
    this.controller = controller;
  }

  getSelectedIds() {
    return unique([...this.controller.selectedTaskIds]);
  }

  getSelectedTasks() {
    return this.getSelectedIds().map(id => AppState.getTask(id)).filter(Boolean);
  }

  getTagState(tagId) {
    const tasks = this.getSelectedTasks();
    if (!tasks.length) return 'none';
    const count = tasks.filter(task => (task.tags || []).includes(tagId)).length;
    if (count === 0) return 'none';
    if (count === tasks.length) return 'all';
    return 'some';
  }

  getProjectEligibility() {
    const ids = new Set(this.getSelectedIds());
    const tasks = [...ids].map(id => AppState.getTask(id)).filter(Boolean);
    if (!tasks.length) return { valid: false, reason: 'Select at least one task.', rootIds: [] };
    for (const task of tasks) {
      if (task.parentTaskId && !ids.has(task.parentTaskId)) {
        return {
          valid: false,
          reason: 'Subtasks inherit their parent Project.',
          rootIds: []
        };
      }
    }
    return {
      valid: true,
      reason: '',
      rootIds: unique(tasks.filter(task => !task.parentTaskId).map(task => task.id))
    };
  }

  getLinkParentEligibility() {
    const tasks = this.getSelectedTasks();
    if (!tasks.length) return { valid: false, reason: 'Select at least one task.' };
    for (const task of tasks) {
      if (task.parentTaskId) return { valid: false, reason: 'Only root tasks can be linked to a parent.' };
      if (AppState.hasSubtasks(task.id)) {
        return { valid: false, reason: 'Move or unlink a task’s subtasks before linking it.' };
      }
    }
    const candidates = this.getEligibleParentTasks();
    if (!candidates.length) return { valid: false, reason: 'No eligible parent tasks.' };
    return { valid: true, reason: '' };
  }

  getEligibleParentTasks() {
    const selected = new Set(this.getSelectedIds());
    return AppState.getRootTasks()
      .filter(task => !selected.has(task.id) && !task.completed)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.title).localeCompare(String(b.title)));
  }

  async runBatch({ label, ids = this.getSelectedIds(), preflight = null, mutate }) {
    const targetIds = unique(ids);
    if (!targetIds.length || this.controller.batchBusy) return false;

    this.controller.setBatchBusy(true);
    let release = null;
    const succeeded = [];
    try {
      release = await TodoMutationCoordinator.acquireManual();
      if (preflight) await preflight(targetIds);

      for (let index = 0; index < targetIds.length; index += 1) {
        const id = targetIds[index];
        const task = AppState.getTask(id);
        if (!task) {
          this.controller.selectedTaskIds.delete(id);
          continue;
        }
        await mutate(task, id, index);
        succeeded.push(id);
      }
      return true;
    } catch (error) {
      if (succeeded.length) {
        succeeded.forEach(id => this.controller.selectedTaskIds.delete(id));
      }
      AppPersistence.reportError(`Could not finish the selected-task ${label} action.`, error);
      return false;
    } finally {
      release?.();
      this.controller.setBatchBusy(false);
      this.controller.tasks?.render?.();
    }
  }

  async markDone() {
    const ids = this.getSelectedIds().sort((a, b) => {
      const taskA = AppState.getTask(a);
      const taskB = AppState.getTask(b);
      if (Boolean(taskA?.parentTaskId) === Boolean(taskB?.parentTaskId)) return 0;
      return taskA?.parentTaskId ? 1 : -1;
    });
    return this.runBatch({
      label: 'Done',
      ids,
      mutate: async (_task, id) => {
        const current = AppState.getTask(id);
        if (!current || current.completed) return;
        await AppDataService.toggleTaskStatus(id);
      }
    });
  }

  resolveBulkDate(task, chosenDate) {
    if (chosenDate) return chosenDate;
    if (task.dueTime || activeRepeat(task)) return AppState.getTodayDateStr();
    return null;
  }

  validateRepeatEnd(task, finalDate) {
    const end = task?.repeat?.end;
    if (!finalDate || end?.type !== 'date' || !end.date) return;
    if (end.date < finalDate) {
      throw new Error(`“${task.title}” repeats only until ${end.date}, which is before the selected date.`);
    }
  }

  async setDate(chosenDate) {
    const normalizedChoice = chosenDate || null;
    const finalDates = new Map();
    return this.runBatch({
      label: 'Date',
      preflight: async ids => {
        for (const id of ids) {
          const task = AppState.getTask(id);
          if (!task) continue;
          const finalDate = this.resolveBulkDate(task, normalizedChoice);
          this.validateRepeatEnd(task, finalDate);
          finalDates.set(id, finalDate);
        }
      },
      mutate: async (task, id) => {
        const finalDate = this.resolveBulkDate(task, normalizedChoice);
        this.validateRepeatEnd(task, finalDate);
        await AppDataService.updateTask(id, { dueDate: finalDate });
      }
    });
  }

  async setPriority(priority) {
    if (!['', 'low', 'medium', 'high'].includes(priority)) {
      AppPersistence.reportError('Could not change selected-task Priority.', new Error('Invalid priority.'));
      return false;
    }
    return this.runBatch({
      label: 'Priority',
      preflight: async ids => {
        ids.forEach(id => {
          if (!AppState.getTask(id)) throw new Error('A selected task no longer exists.');
        });
      },
      mutate: (_task, id) => AppDataService.updateTask(id, { priority })
    });
  }

  async toggleTag(tagId) {
    const tag = AppState.getTag(tagId);
    if (!tag) {
      AppPersistence.reportError('Could not change selected-task Tags.', new Error('The selected Tag no longer exists.'));
      return false;
    }
    const shouldRemove = this.getTagState(tagId) === 'all';
    return this.runBatch({
      label: 'Tags',
      preflight: async ids => {
        if (!AppState.getTag(tagId)) throw new Error('The selected Tag no longer exists.');
        ids.forEach(id => {
          if (!AppState.getTask(id)) throw new Error('A selected task no longer exists.');
        });
      },
      mutate: async (task, id) => {
        const tags = [...(task.tags || [])];
        const next = shouldRemove
          ? tags.filter(value => value !== tagId)
          : unique([...tags, tagId]);
        await AppDataService.updateTask(id, { tags: next });
      }
    });
  }

  async setProject(projectId = '') {
    const eligibility = this.getProjectEligibility();
    if (!eligibility.valid) {
      AppPersistence.reportError('Could not change selected-task Project.', new Error(eligibility.reason));
      return false;
    }
    if (projectId && !AppState.getProject(projectId)) {
      AppPersistence.reportError('Could not change selected-task Project.', new Error('The selected Project no longer exists.'));
      return false;
    }
    return this.runBatch({
      label: 'Project',
      ids: eligibility.rootIds,
      preflight: async ids => {
        if (projectId && !AppState.getProject(projectId)) throw new Error('The selected Project no longer exists.');
        for (const id of ids) {
          const task = AppState.getTask(id);
          if (!task || task.parentTaskId) throw new Error('Only root tasks can receive a Project change.');
        }
      },
      mutate: (task, id) => {
        if (task.parentTaskId) throw new Error('Only root tasks can receive a Project change.');
        return AppDataService.updateTask(id, { project: projectId || '' });
      }
    });
  }

  normalizedDeleteTargets() {
    const selected = new Set(this.getSelectedIds());
    const targets = [];
    for (const id of selected) {
      const task = AppState.getTask(id);
      if (!task) continue;
      if (task.parentTaskId && selected.has(task.parentTaskId)) continue;
      targets.push(id);
    }
    return unique(targets);
  }

  async deleteSelected() {
    const targets = this.normalizedDeleteTargets();
    if (!targets.length) return false;
    const familyChildren = targets.reduce((count, id) => {
      const task = AppState.getTask(id);
      return count + (task && !task.parentTaskId ? AppState.getSubtasks(task.id).length : 0);
    }, 0);
    const consequence = familyChildren
      ? '\nParent tasks will also delete their subtasks.'
      : '';
    if (!window.confirm(`Delete the selected tasks?${consequence}`)) return false;

    const ok = await this.runBatch({
      label: 'Delete',
      ids: targets,
      preflight: async ids => {
        ids.forEach(id => {
          if (!AppState.getTask(id)) throw new Error('A selected task no longer exists.');
        });
      },
      mutate: (_task, id) => AppDataService.deleteTaskFamily(id)
    });
    this.controller.pruneSelection();
    return ok;
  }

  async linkParent(parentId) {
    const eligibility = this.getLinkParentEligibility();
    if (!eligibility.valid) {
      AppPersistence.reportError('Could not link the selected tasks.', new Error(eligibility.reason));
      return false;
    }
    return this.runBatch({
      label: 'Link Parent Task',
      preflight: async ids => {
        const parent = AppState.getTask(parentId);
        if (!parent || parent.parentTaskId || parent.completed) throw new Error('The chosen parent is no longer eligible.');
        if (ids.includes(parentId)) throw new Error('A selected task cannot also be its parent.');
        for (const id of ids) {
          const task = AppState.getTask(id);
          if (!task || task.parentTaskId || AppState.hasSubtasks(id)) {
            throw new Error('Every selected task must still be a root task without subtasks.');
          }
        }
      },
      mutate: async (task, id) => {
        const parent = AppState.getTask(parentId);
        if (!parent || parent.parentTaskId || parent.completed) throw new Error('The chosen parent is no longer eligible.');
        if (task.parentTaskId || AppState.hasSubtasks(id)) {
          throw new Error('The selected task is no longer eligible to link.');
        }
        await AppDataService.linkTaskToParent(id, parentId);
      }
    });
  }
}
