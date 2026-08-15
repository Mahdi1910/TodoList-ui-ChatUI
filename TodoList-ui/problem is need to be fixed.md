# Problems That Need to Be Fixed

This file is the permanent cleanup/problem tracker for the application.

## How to use this file

- `[ ]` = still needs work.
- `[x]` = fixed and verified.
- When a problem is fixed, change its checkbox to `[x]` and add the fixing commit/plan when useful.
- Do not mark a problem complete only because code was written. Mark it complete after the implementation is reviewed and the important behavior is manually verified.
- This application is for personal use. Priorities below focus on correctness, maintainability, data safety, and smooth everyday use — not large-scale/server concerns.

---

# Priority 1 — Real behavior / correctness problems

- [x] **1. Fix task-family filtering.**
  - Current filtering works on individual tasks, but List/Kanban rendering later keeps only roots and then reloads all children from global state.
  - This can hide a matching subtask when its parent does not match the filter.
  - It can also show subtasks that do not match a filter when their parent does match.
  - Define one clear family-aware filtering rule and use it in both List and Kanban.

- [x] **2. Fix modal focus and `aria-hidden` lifecycle everywhere.**
  - Current dialogs can be hidden while keyboard focus is still inside them.
  - This produces the browser warning: `Blocked aria-hidden on an element because its descendant retained focus`.
  - Affects Project, Tag, Task, Subtask, Schedule, Settings, Custom Reminder, Custom Repeat, and Repeat Ends flows.
  - Use one shared focus lifecycle with focus restoration and `inert` for hidden dialogs.
  - Related plan: `implementation plan/Implementation Plan ID 13.md`.

- [x] **3. Fix unsafe HTML building in Task Project/Tag menus.**
  - Some menu rendering uses `innerHTML` with a helper named `escapeText()` that does not actually HTML-escape its value.
  - Prefer DOM creation + `textContent` for user-controlled Project/Tag names and icons.
  - Related plan: `implementation plan/Implementation Plan ID 16.md`.

- [x] **4. Fix Subtask Tag menu ordering.**
  - The main Task editor uses the new taxonomy ordering system.
  - The Subtask editor still walks `AppState.tags` directly, so reordered Tags can appear in the old order there.
  - Use `TaxonomyOrder.getChildren()` / the same ordering source used by the main Task editor.

- [ ] **5. Decide and implement real reminder delivery.**
  - Reminder definitions and task-reminder relations are stored correctly.
  - The application currently has reminder configuration, but no clear notification-delivery engine.
  - If reminders are expected to alert the user, implement actual browser/system notification scheduling/delivery.

---

# Priority 2 — Architecture / maintainability problems

- [x] **6. Remove `ui-persistence-bindings.js` as a large runtime patch layer.**
  - It replaces methods belonging to Tasks, Subtasks, Projects, Tags, Workspace Controls, drag, and reminders after components are already defined.
  - Move persistent behavior into the real owning component/service so every action has one clear implementation.
  - Goal: UI -> AppDataService -> IndexedDB -> AppState -> render.

- [x] **7. Remove Repeat mapper/service monkey-patching.**
  - `repeat-storage.js` replaces mapper and AppDataService methods at runtime.
  - `data-service-repeat.js` also replaces task-completion behavior.
  - Make the Repeat-aware implementation explicit instead of decorating/replacing existing methods after load.

- [x] **8. Reduce AppState responsibilities.**
  - `state.js` currently mixes seed data, normalization, task/project/tag CRUD, filtering, counts, hierarchy helpers, navigation state, and more.
  - Keep AppState primarily as the hydrated read model + selectors.
  - Keep mutations in AppDataService and hierarchy/order logic in their dedicated modules.

- [x] **9. Merge duplicated Project and Tag sidebar/modal logic.**
  - `sidebar-projects.js` and `sidebar-tags.js` are mostly mirror implementations.
  - Build a shared taxonomy UI helper/component configured for `project` or `tag`.
  - This reduces the chance of fixing one side but forgetting the other.

- [x] **10. Remove UI-component dependency from the data layer.**
  - AppDataService currently reaches into `ScheduleComponent.customReminders`.
  - Persistence hydration also writes reminder data directly into ScheduleComponent.
  - Reminder definitions should live in state/service data; Schedule should read them from there.

- [x] **11. Simplify JavaScript module loading / bootstrap order.**
  - The app loads many scripts statically and then loads another ordered list dynamically in `app.js`.
  - Sequential dynamic loading makes startup depend heavily on exact script order.
  - Prefer a clearer explicit module system (native ES modules is enough; no framework required).

- [x] **12. Improve bootstrap error reporting.**
  - A missing JS module/integration failure can currently end up showing a message that says local storage could not be opened.
  - Separate module-load, integration, database-open, hydration, and repair errors so debugging is accurate.

- [x] **13. Remove dead/duplicate HTML that JavaScript immediately replaces.**
  - Some menus are fully written in `index.html` and then rebuilt with JavaScript.
  - Keep one source of truth for each UI structure.

- [x] **14. Stop runtime-upgrading permanent markup when static HTML can be correct from the start.**
  - Example: the Completed header starts as a div and JavaScript later replaces it with a button.
  - Permanent controls should preferably be correct semantic elements in `index.html` from first paint.

---

# Priority 3 — Accessibility / interaction quality

- [x] **15. Fix hidden-sidebar focus handling.**
  - The sidebar can receive `aria-hidden="true"` while focus is still inside a sidebar control.
  - Apply the same general focus/inert principles used for dialogs.

- [x] **16. Make dynamic Project/Tag rows proper keyboard controls.**
  - Static sidebar filters are buttons, but generated Project/Tag rows are clickable divs.
  - Use semantic buttons or provide complete keyboard/focus behavior.

- [x] **17. Remove mobile pinch-zoom blocking.**
  - The viewport currently uses `maximum-scale=1.0` and `user-scalable=no`.
  - Remove those restrictions unless there is a very strong UI reason to keep them.

- [x] **18. Make the Task Project picker visually show Project hierarchy depth.**
  - The picker uses the flattened hierarchy order but currently does not visibly indent nested Projects.
  - Make nested Projects visually understandable, similar to Tags.

---

# Priority 4 — Performance / hidden side effects

- [x] **19. Make filtering/selectors read-only.**
  - `getFilteredTasks()` currently calls `normalizeAllTasks()`, recreating/replacing task objects during a read operation.
  - A selector should not mutate or rebuild application state.

- [x] **20. Remove render-time mutation of Repeat data.**
  - Repeat label formatting sorts `custom.weekdays` in place.
  - Rendering should never mutate stored state; sort a copied array instead.

- [ ] **21. Reduce unnecessary full rerenders where simple updates are enough.**
  - Many mutations rebuild large parts of List/Kanban and recalculate sidebar counts.
  - This is acceptable for current personal-use scale, so it is low priority.
  - Improve only after correctness/architecture cleanup.

- [x] **22. Remove duplicated date-label formatting logic.**
  - Today/Tomorrow/date formatting exists in more than one Task renderer method.
  - Use one small shared formatting helper.

- [x] **23. Make Repeat date parsing stricter.**
  - JavaScript can normalize invalid dates such as an impossible day into another month.
  - Validate that parsed year/month/day exactly match the source string.

---

# Priority 5 — Safety / testing / cleanup

- [x] **24. Add JSON Export / Import backup.**
  - The IndexedDB design is good, but the data is still browser-local.
  - Add a simple full-data backup/export and validated transactional restore/import.
  - This is important for a personal application because clearing browser/site data could otherwise lose everything.
  - Related plan: `implementation plan/Implementation Plan ID 19.md`.

- [ ] **25. Add small pure-JavaScript tests for complex logic.**
  - No browser automation is required.
  - Highest-value targets: RepeatEngine, family-aware filtering, taxonomy ordering, task hierarchy, hierarchy drag resolver, and persistence repair/mappers.

- [ ] **26. Hide/remove placeholder app modules until they are real.**
  - AI Assistant, Habit Tracker, and Diary entries add UI clutter if they are not being built soon.

- [ ] **27. Make CSS loading more explicit.**
  - `project-tags.css` imports `sidebar-taxonomy-drag.css` internally.
  - Low priority: consider loading component styles explicitly from the main HTML instead of creating another hidden stylesheet dependency.

---

# Completed problems

Move items here only when useful for history, or simply leave them in their original section with `[x]`.

- [x] **Project/Tag hierarchy drag: last-child outdent bug.**
  - When a parent had multiple children, the last dragged child could be trapped by its own source forced-child zone and fail to outdent.
  - Fixed by recording original ancestor zones and suppressing source-ancestor forced zones when horizontal intent moves shallower.
  - Implementation Plan: `implementation plan/Implementation Plan ID 14.md`.

---

# Tracker rule

Whenever we implement one of the problems above, update this file in the same work session and change the matching checkbox from `[ ]` to `[x]` only after the fix has been reviewed/verified.
