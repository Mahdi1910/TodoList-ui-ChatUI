import { TodoStorageMappers } from './mappers.js';
import { TodoRepositories } from './repositories.js';
import { TodoDb } from './db.js';
import { TodoDbSchema } from './db-schema.js';
import { TaxonomyOrder } from '../taxonomy-order.js';
import { AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';
export const DataServiceTaxonomyDragMethods = {
  taxonomyConfig(entityType) {
    if (!['project', 'tag'].includes(entityType)) throw new Error('Invalid taxonomy type.');
    const type = entityType;
    return {
      type,
      items: type === 'project' ? AppState.projects : AppState.tags,
      store: type === 'project' ? TodoDbSchema.STORES.PROJECTS : TodoDbSchema.STORES.TAGS,
      label: type === 'project' ? 'Project' : 'Tag'
    };
  },

  validateTaxonomyParent(entityType, entityId, parentId) {
    const config = this.taxonomyConfig(entityType);
    const entity = TaxonomyOrder.getEntity(config.type, entityId);
    if (!entity) throw new Error(`${config.label} not found.`);
    if (!parentId) return { entity, parent: null, config };
    const parent = TaxonomyOrder.getEntity(config.type, parentId);
    if (!parent) throw new Error(`Parent ${config.label.toLowerCase()} not found.`);
    if (parent.id === entity.id) throw new Error(`${config.label} cannot be its own parent.`);
    const descendants = new Set(TaxonomyOrder.getDescendantIds(config.type, entity.id));
    if (descendants.has(parent.id)) throw new Error(`${config.label} hierarchy cannot contain a cycle.`);
    return { entity, parent, config };
  },

  taxonomyCopies(entityType) {
    const { items } = this.taxonomyConfig(entityType);
    return new Map(items.map(item => [item.id, { ...item }]));
  },

  taxonomySiblingIds(entityType, parentId = null, excludeId = null, copies = null) {
    const source = copies ? [...copies.values()] : this.taxonomyConfig(entityType).items;
    return TaxonomyOrder.getSiblingIds(entityType, parentId, excludeId, source);
  },

  insertTaxonomyRelative(ids, entityId, beforeEntityId = null, afterEntityId = null) {
    const ordered = [...ids].filter(id => id !== entityId);
    const beforeIndex = beforeEntityId ? ordered.indexOf(beforeEntityId) : -1;
    if (beforeIndex >= 0) {
      ordered.splice(beforeIndex, 0, entityId);
      return ordered;
    }
    const afterIndex = afterEntityId ? ordered.indexOf(afterEntityId) : -1;
    if (afterIndex >= 0) {
      ordered.splice(afterIndex + 1, 0, entityId);
      return ordered;
    }
    ordered.push(entityId);
    return ordered;
  },

  applyTaxonomyScope(copies, parentId, orderedIds, changedIds, now) {
    orderedIds.forEach((id, sortOrder) => {
      const copy = copies.get(id);
      if (!copy) return;
      const nextParentId = parentId || null;
      if (copy.parentId !== nextParentId || copy.sortOrder !== sortOrder) copy.updatedAt = now;
      copy.parentId = nextParentId;
      copy.sortOrder = sortOrder;
      changedIds.add(id);
    });
  },

  async persistTaxonomyCopies(entityType, copies, changedIds) {
    const { store } = this.taxonomyConfig(entityType);
    await TodoDb.withTransaction(store, 'readwrite', async tx => {
      for (const id of changedIds) {
        const copy = copies.get(id);
        if (copy) await TodoRepositories.put(tx, store, copy);
      }
    });
  },

  applyTaxonomyMemory(entityType, copies, changedIds) {
    return AppStateSync.applyTaxonomyChanges(entityType, copies, changedIds);
  },

  prepareTaxonomyDelete(entityType, entityId) {
    const { entity, config } = this.validateTaxonomyParent(entityType, entityId, null);
    const copies = this.taxonomyCopies(config.type);
    const changed = new Set();
    const now = TodoStorageMappers.nowIso();
    const sourceParentId = entity.parentId || null;
    const childIds = this.taxonomySiblingIds(config.type, entity.id, null, copies);

    if (sourceParentId === null) {
      const rootIds = this.taxonomySiblingIds(config.type, null, null, copies);
      const index = rootIds.indexOf(entity.id);
      const nextRoots = rootIds.filter(id => id !== entity.id);
      nextRoots.splice(index >= 0 ? index : nextRoots.length, 0, ...childIds);
      this.applyTaxonomyScope(copies, null, nextRoots, changed, now);
    } else {
      const sourceIds = this.taxonomySiblingIds(config.type, sourceParentId, entity.id, copies);
      this.applyTaxonomyScope(copies, sourceParentId, sourceIds, changed, now);
      const rootIds = this.taxonomySiblingIds(config.type, null, entity.id, copies);
      this.applyTaxonomyScope(copies, null, [...rootIds, ...childIds], changed, now);
    }

    changed.delete(entity.id);
    return { entity, config, copies, changed, childIds, now };
  },

  async updateTaxonomyEntityWithOrder(entityType, entityId, data = {}) {
    const existingConfig = this.taxonomyConfig(entityType);
    const existing = TaxonomyOrder.getEntity(existingConfig.type, entityId);
    if (!existing) throw new Error(`${existingConfig.label} not found.`);
    const targetParentId = data.parentId === undefined ? (existing.parentId || null) : (data.parentId || null);
    const { entity, config } = this.validateTaxonomyParent(entityType, entityId, targetParentId);
    const name = String(data.name ?? entity.name).trim();
    if (!name) throw new Error(`${config.label} name is required.`);
    const sourceParentId = entity.parentId || null;
    const copies = this.taxonomyCopies(config.type);
    const changed = new Set([entityId]);
    const now = TodoStorageMappers.nowIso();
    const moved = copies.get(entityId);
    const viewType = data.viewType === undefined
      ? (entity.viewType === 'kanban' ? 'kanban' : 'list')
      : (data.viewType === 'kanban' ? 'kanban' : 'list');
    Object.assign(moved, {
      name,
      icon: data.icon ?? entity.icon ?? '●',
      viewType,
      updatedAt: now
    });

    if (sourceParentId !== targetParentId) {
      const sourceIds = this.taxonomySiblingIds(config.type, sourceParentId, entityId, copies);
      const destinationBase = this.taxonomySiblingIds(config.type, targetParentId, entityId, copies);
      const destinationIds = [...destinationBase, entityId];
      this.applyTaxonomyScope(copies, sourceParentId, sourceIds, changed, now);
      this.applyTaxonomyScope(copies, targetParentId, destinationIds, changed, now);
    } else {
      moved.parentId = sourceParentId;
    }

    await this.persistTaxonomyCopies(config.type, copies, changed);
    this.applyTaxonomyMemory(config.type, copies, changed);
    return TaxonomyOrder.getEntity(config.type, entityId);
  },

  commitTaxonomyDrag({
    entityType,
    entityId,
    targetParentId = null,
    beforeEntityId = null,
    afterEntityId = null
  } = {}) {
    return this.enqueue(async () => {
      const { entity, config } = this.validateTaxonomyParent(entityType, entityId, targetParentId);
      const sourceParentId = entity.parentId || null;
      const copies = this.taxonomyCopies(config.type);
      const changed = new Set();
      const now = TodoStorageMappers.nowIso();
      const sourceIds = this.taxonomySiblingIds(config.type, sourceParentId, entityId, copies);
      const destinationBase = sourceParentId === (targetParentId || null)
        ? sourceIds
        : this.taxonomySiblingIds(config.type, targetParentId, entityId, copies);
      const destinationIds = this.insertTaxonomyRelative(destinationBase, entityId, beforeEntityId, afterEntityId);

      if (sourceParentId !== (targetParentId || null)) {
        this.applyTaxonomyScope(copies, sourceParentId, sourceIds, changed, now);
      }
      this.applyTaxonomyScope(copies, targetParentId, destinationIds, changed, now);

      await this.persistTaxonomyCopies(config.type, copies, changed);
      this.applyTaxonomyMemory(config.type, copies, changed);
      return TaxonomyOrder.getEntity(config.type, entityId);
    });
  }
};
