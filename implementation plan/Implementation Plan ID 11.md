# Implementation Plan ID 11 — UI Consistency Pass

## Goal

Polish the existing ChatUI/shell presentation without changing chat, Gemini, storage, Workspace, project, attachment, voice, or tool execution semantics.

This plan addresses five reviewed UI issues:

1. keyboard focus is not always visually obvious;
2. mobile shell navigation labels are too small;
3. `Workspace` is used both for the Workspace destination and the AI permission/tool capability;
4. Live Voice does not explicitly respect phone safe areas;
5. generic mobile dialogs can sit too close to device edges.

## Scope

### 1. Consistent keyboard focus

- Preserve the existing focus-visible ring for buttons, links, and custom focusable rows.
- Add the same accent-colored focus language to native input, textarea, and select controls.
- Show focus on the complete icon-wrapped modal field rather than only the inner text surface.
- Add explicit visible focus to Settings switches and AI tool switches whose real checkbox inputs are visually hidden.
- Add an explicit focus-visible ring to the rich Markdown composer surface.

Mouse/touch behavior and control semantics must remain unchanged.

### 2. Mobile shell navigation readability

- Keep the existing bottom navigation height and ordering.
- Increase mobile labels from 9px to 11px.
- Use a modest 500 weight and 1.1 line-height.
- Preserve the keyboard behavior from Plan 10: the navigation stays anchored to the shell layout bottom and is covered by the software keyboard rather than moving above it.

### 3. Workspace destination vs AI capability

- Keep the left-sidebar destination named `Workspace`.
- Rename only the AI capability/toggle to `Workspace Access` in the composer Tools menu and right Controls panel.
- Keep the existing functional key `workspace`; this is a presentation rename only.
- Add concise accessible/help text: `Allow the AI to work with your Workspace files.`
- Active tool indicator labels must also say `Workspace Access`.

### 4. Live Voice safe areas

- Preserve the Live Voice visual design, orb behavior, controls, states, and audio behavior.
- Replace fixed outer padding with safe-area-aware padding that keeps at least the existing 24px rhythm while adding room for notches, rounded corners, and gesture/home indicators.

### 5. Mobile dialog margins

- Add safe-area-aware mobile padding to the generic modal overlay.
- Generic create/rename/project dialogs must fit inside that padded area rather than touching screen edges.
- Search and Settings retain their dedicated responsive sizing but must also fit inside the safe area.
- No modal interaction logic changes are included.

## Version

Bump visible ChatUI Settings version from `1.8` to `1.9` and update previous regression version assertions.

## Verification

- Add `scripts/verify-chatui-plan11.mjs` for the new UI invariants.
- Run Plan 7, Plan 8, Plan 9, Plan 10, Plan 11, and iframe integration checks on the exact pull-request head.
- Run the safe static build.
- Require successful Cloudflare commit/branch preview for the exact shippable head.
- Do not use browser automation.

## Non-goals

- No Gemini request/generation changes.
- No database or persistence changes.
- No Workspace tool/function changes.
- No project/chat behavior changes.
- No redesign of the Live Voice orb.
- No shell navigation reordering.
- No Settings information-architecture changes beyond the visible version bump.
