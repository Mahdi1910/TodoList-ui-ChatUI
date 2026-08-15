import { SidebarTaxonomyCore } from './sidebar-taxonomy-core.js';

export const SidebarTagConfig = Object.freeze({
  entityType: 'tag',
  stem: 'Tag',
  pluralStem: 'Tags',
  childLabel: 'Sub-tag',
  topLevelLabel: 'No parent (top-level tag)',
  deletePrompt: name => `Delete tag "${name}"? Child tags will become top-level tags.`
});

export const SidebarTagMethods = SidebarTaxonomyCore.createMethods(SidebarTagConfig);
