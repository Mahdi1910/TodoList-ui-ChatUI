import { TaxonomyOrder } from '../taxonomy-order.js';
export const TaskTaxonomyMenuOrderMethods = {
  renderProjectMenu() {
    if (!this.menuProject) return;
    this.menuProject.innerHTML = '';

    const inboxItem = document.createElement('div');
    inboxItem.className = `context-menu-item${this.selectedProject === '' ? ' selected' : ''}`;
    inboxItem.dataset.project = '';
    inboxItem.textContent = 'Inbox';
    inboxItem.setAttribute('role', 'option');
    inboxItem.setAttribute('tabindex', '-1');
    inboxItem.setAttribute('aria-selected', this.selectedProject === '' ? 'true' : 'false');
    this.menuProject.appendChild(inboxItem);

    TaxonomyOrder.flattenTree('project').forEach(({ item: project, depth }) => {
      this.menuProject.appendChild(this.createProjectMenuItem(project, depth));
    });
  },

  renderTagMenu() {
    if (!this.menuTags) return;
    this.menuTags.innerHTML = '';
    const renderLevel = (parentId, depth = 0) => {
      TaxonomyOrder.getChildren('tag', parentId).forEach(tag => {
        this.menuTags.appendChild(this.createTagMenuItem(tag, depth));
        renderLevel(tag.id, depth + 1);
      });
    };
    renderLevel(null);
    this.bindTagMenuItems();
  }
};
