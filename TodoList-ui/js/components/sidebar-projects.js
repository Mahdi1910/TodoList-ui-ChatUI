import { SidebarTaxonomyCore } from './sidebar-taxonomy-core.js';

export const SidebarProjectConfig = Object.freeze({
  entityType: 'project',
  stem: 'Project',
  pluralStem: 'Projects',
  childLabel: 'Sub-project',
  topLevelLabel: 'No parent (top-level project)',
  deletePrompt: name => `Delete project "${name}"? Its direct sub-projects will become top-level.`
});

export const SidebarProjectMethods = SidebarTaxonomyCore.createMethods(SidebarProjectConfig);
