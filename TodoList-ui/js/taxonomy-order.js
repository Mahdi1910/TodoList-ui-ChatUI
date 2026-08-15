import { AppState } from './state.js';

export const TaxonomyOrder = (() => {
  const normalizeType = type => type === 'tag' ? 'tag' : 'project';

  function getItems(type) {
    return normalizeType(type) === 'project' ? AppState.projects : AppState.tags;
  }

  function getEntity(type, entityId) {
    if (!entityId) return null;
    return getItems(type).find(item => item.id === entityId) || null;
  }

  function compareEntityOrder(a, b) {
    const aOrder = Number.isFinite(a?.sortOrder) ? a.sortOrder : 0;
    const bOrder = Number.isFinite(b?.sortOrder) ? b.sortOrder : 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    const created = String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
    if (created) return created;
    const name = String(a?.name || '').localeCompare(String(b?.name || ''), undefined, { sensitivity: 'base' });
    return name || String(a?.id || '').localeCompare(String(b?.id || ''));
  }

  function getChildren(type, parentId = null, items = null) {
    const source = items || getItems(type);
    const normalizedParent = parentId || null;
    return source
      .filter(item => (item.parentId || null) === normalizedParent)
      .sort(compareEntityOrder);
  }

  function getSiblingIds(type, parentId = null, excludeId = null, items = null) {
    return getChildren(type, parentId, items)
      .map(item => item.id)
      .filter(id => id !== excludeId);
  }

  function nextSortOrder(type, parentId = null, items = null) {
    const siblings = getChildren(type, parentId, items);
    const values = siblings.map(item => item.sortOrder).filter(Number.isFinite);
    return values.length ? Math.max(...values) + 1 : 0;
  }

  function getDescendantIds(type, entityId, items = null) {
    const source = items || getItems(type);
    const result = [];
    const walk = parentId => {
      getChildren(type, parentId, source).forEach(child => {
        result.push(child.id);
        walk(child.id);
      });
    };
    walk(entityId);
    return result;
  }

  function getDepth(type, entityId, items = null) {
    const source = items || getItems(type);
    const byId = new Map(source.map(item => [item.id, item]));
    let current = byId.get(entityId);
    let depth = 0;
    const seen = new Set();
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      current = byId.get(current.parentId);
      if (!current) break;
      depth += 1;
    }
    return depth;
  }

  function flattenTree(type, items = null) {
    const source = items || getItems(type);
    const flattened = [];
    const included = new Set();
    const walk = (parentId, depth) => {
      getChildren(type, parentId, source).forEach(item => {
        if (included.has(item.id)) return;
        included.add(item.id);
        flattened.push({ item, depth, parentId: parentId || null });
        walk(item.id, depth + 1);
      });
    };
    walk(null, 0);
    source.filter(item => !included.has(item.id)).sort(compareEntityOrder).forEach(item => {
      included.add(item.id);
      flattened.push({ item, depth: 0, parentId: null });
    });
    return flattened;
  }

  return {
    normalizeType,
    getItems,
    getEntity,
    compareEntityOrder,
    getChildren,
    getSiblingIds,
    nextSortOrder,
    getDescendantIds,
    getDepth,
    flattenTree
  };
})();
