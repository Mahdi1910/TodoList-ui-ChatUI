import { TodoStorageMappers } from './mappers.js';
import { TodoRepositories } from './repositories.js';
import { TodoDb } from './db.js';
import { TodoDbSchema } from './db-schema.js';
import { TaxonomyOrder } from '../taxonomy-order.js';
import { AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';
export const DataServiceTaxonomyMethods = {
  nextEntitySortOrder(items = []) {
    const values = items.map(item => item.sortOrder).filter(Number.isFinite);
    return values.length ? Math.max(...values) + 1 : 0;
  },

  createProject(projectData = {}) {
    return this.enqueue(async () => {
      const name = String(projectData.name || '').trim();
      if (!name) throw new Error('Project name is required.');
      const parentId = projectData.parentId || null;
      if (parentId && !AppState.getProject(parentId)) throw new Error('Parent project not found.');
      const now = TodoStorageMappers.nowIso();
      const project = {
        id: this.createId('project'), name, icon: projectData.icon || '●',
        viewType: projectData.viewType === 'kanban' ? 'kanban' : 'list', parentId,
        sortOrder: TaxonomyOrder.nextSortOrder('project', parentId), createdAt: now, updatedAt: now
      };
      const S = TodoDbSchema.STORES;
      await TodoDb.withTransaction(S.PROJECTS, 'readwrite', tx =>
        TodoRepositories.add(tx, S.PROJECTS, project)
      );
      AppStateSync.upsertTaxonomyEntity('project', project);
      return AppState.getProject(project.id);
    });
  },

  updateProject(projectId, projectData = {}) {
    return this.enqueue(() => this.updateTaxonomyEntityWithOrder('project', projectId, projectData));
  },

  deleteProject(projectId) {
    return this.enqueue(async () => {
      if (!AppState.getProject(projectId)) return false;
      const plan = this.prepareTaxonomyDelete('project', projectId);
      const affectedTasks = AppState.tasks
        .filter(item => item.project === projectId)
        .map(item => ({ ...item, project: '', updatedAt: plan.now }));
      const S = TodoDbSchema.STORES;
      await TodoDb.withTransaction([S.PROJECTS, S.TASKS], 'readwrite', async tx => {
        for (const id of plan.changed) {
          const copy = plan.copies.get(id);
          if (copy) await TodoRepositories.put(tx, S.PROJECTS, copy);
        }
        const tasks = await TodoRepositories.getAllByIndex(tx, S.TASKS, 'by_project_id', projectId);
        for (const task of tasks) {
          await TodoRepositories.put(tx, S.TASKS, { ...task, projectId: null, updatedAt: plan.now });
        }
        await TodoRepositories.remove(tx, S.PROJECTS, projectId);
      });
      this.applyTaxonomyMemory('project', plan.copies, plan.changed);
      AppStateSync.removeTaxonomyEntity('project', projectId);
      AppStateSync.replaceTasks(affectedTasks);
      return true;
    });
  },

  createTag(tagData = {}) {
    return this.enqueue(async () => {
      const name = String(tagData.name || '').trim();
      if (!name) throw new Error('Tag name is required.');
      const parentId = tagData.parentId || null;
      if (parentId && !AppState.getTag(parentId)) throw new Error('Parent tag not found.');
      const now = TodoStorageMappers.nowIso();
      const tag = {
        id: this.createId('tag'), name, icon: tagData.icon || '●',
        viewType: tagData.viewType === 'kanban' ? 'kanban' : 'list', parentId,
        sortOrder: TaxonomyOrder.nextSortOrder('tag', parentId), createdAt: now, updatedAt: now
      };
      const S = TodoDbSchema.STORES;
      await TodoDb.withTransaction(S.TAGS, 'readwrite', tx =>
        TodoRepositories.add(tx, S.TAGS, tag)
      );
      AppStateSync.upsertTaxonomyEntity('tag', tag);
      return AppState.getTag(tag.id);
    });
  },

  updateTag(tagId, tagData = {}) {
    return this.enqueue(() => this.updateTaxonomyEntityWithOrder('tag', tagId, tagData));
  },

  deleteTag(tagId) {
    return this.enqueue(async () => {
      if (!AppState.getTag(tagId)) return false;
      const plan = this.prepareTaxonomyDelete('tag', tagId);
      const affectedTasks = AppState.tasks
        .filter(task => (task.tags || []).includes(tagId))
        .map(task => ({ ...task, tags: (task.tags || []).filter(id => id !== tagId) }));
      const S = TodoDbSchema.STORES;
      await TodoDb.withTransaction([S.TAGS, S.TASK_TAGS], 'readwrite', async tx => {
        for (const id of plan.changed) {
          const copy = plan.copies.get(id);
          if (copy) await TodoRepositories.put(tx, S.TAGS, copy);
        }
        await TodoRepositories.deleteByIndex(tx, S.TASK_TAGS, 'by_tag_id', tagId);
        await TodoRepositories.remove(tx, S.TAGS, tagId);
      });
      this.applyTaxonomyMemory('tag', plan.copies, plan.changed);
      AppStateSync.removeTaxonomyEntity('tag', tagId);
      AppStateSync.replaceTasks(affectedTasks);
      return true;
    });
  },

  setEntityViewType(entityType, entityId, viewType) {
    return this.enqueue(async () => {
      const normalizedView = viewType === 'kanban' ? 'kanban' : 'list';
      const isProject = entityType === 'project';
      const entity = isProject ? AppState.getProject(entityId) : AppState.getTag(entityId);
      if (!entity) throw new Error(`${isProject ? 'Project' : 'Tag'} not found.`);
      const updated = { ...entity, viewType: normalizedView, updatedAt: TodoStorageMappers.nowIso() };
      const storeName = isProject ? TodoDbSchema.STORES.PROJECTS : TodoDbSchema.STORES.TAGS;
      await TodoDb.withTransaction(storeName, 'readwrite', tx =>
        TodoRepositories.put(tx, storeName, updated)
      );
      AppStateSync.upsertTaxonomyEntity(isProject ? 'project' : 'tag', updated);
      return isProject ? AppState.getProject(entityId) : AppState.getTag(entityId);
    });
  }
};
