# Syncing upstream into the fork

This fork merges `getpaseo/paseo` `main` into `zfan2356/paseo` `main` every few days. This doc covers the material layer: what it owns, where it touches upstream files, and what to run after a merge. The design rules are in [design-materials.md](design-materials.md).

## Ownership

The fork owns these directories outright. Upstream never edits them, so they never conflict:

- `packages/app/src/fork/materials/`: tokens, slot names, stylesheet, sidebar color, sheet background, floating layout, workspace panel.
- `packages/desktop/src/fork/materials/`: macOS window transparency and vibrancy.
- `packages/app/e2e/browser/materials*.spec.ts`, `packages/app/playwright.materials.config.ts`.
- `docs/fork/`, `scripts/fork/`, `docs/qa-evidence/materials/`.

Upstream files carry only hooks: an import plus a `dataSet={MATERIAL_SLOTS.x}` attribute, or a single call into the fork directory. `docs/design.md` stays identical to upstream; `styles/theme.ts` and `playwright.config.ts` carry no material changes.

## Hook list

Generate it; don't edit a list by hand:

```bash
git fetch upstream main
node scripts/fork/material-layer.mjs hooks
```

It prints every line in an upstream-owned file that references the layer. The groups below explain why each hook exists. When a file in the output is not covered here, either the hook is new and belongs in a group, or it is a regression.

| Group                | Files                                                                                                                                                                                                                           | Hook                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Install              | `root-app.tsx`, `app/_layout.tsx` (`window` on its three root views)                                                                                                                                                            | `<Materials />` installs the stylesheet; `window` marks the app background.                                                           |
| Window skeleton      | `app/_layout.tsx` (`WorkspacePanel` around the workspace children), `left-sidebar.tsx` (`sidebar` on the pinned sidebar), `settings-screen.tsx` (`settings` on the desktop split root)                                          | `panel-frame` and `panel` float the workspace; `sidebar` takes the floor and drops its right border; `settings` repeats the skeleton. |
| Floating primitives  | `ui/floating.tsx`, `ui/menu/menu-overlay.tsx`, `ui/autocomplete.tsx`, `ui/isolated-bottom-sheet-modal/index.tsx`                                                                                                                | `FloatingSurface` tags `popover`, or `tooltip` when `role="tooltip"`; menus `menu`; Gorhom sheets `sheet`.                            |
| Dialogs and sheets   | `adaptive-modal-sheet.tsx`, `ui/combobox.tsx` (sheet background), `command-center.tsx`, `add-project-flow.tsx`, `hosts/host-chooser.tsx`, `agent-list.tsx`, `attachment-lightbox.tsx`, `mermaid/fullscreen-viewer.web.tsx`      | `dialog`, `sheet` or `fullscreen` on the panel root.                                                                                  |
| Workspace chrome     | `adaptive-workspace-chrome.tsx`, `split-container.tsx`, `workspace-screen.tsx` (`materialTab`), `headers/screen-header.tsx`, `headers/compact-header.tsx`, `workspace-desktop-tabs-row.tsx`                                     | `workspaceChromeSlot()` and `publishChromeClearance()`; `header` on headers.                                                          |
| Composer and stream  | `composer/dock/index.tsx`, `composer/input/presentation.tsx`, `composer/tracks.tsx`, `agent-stream/view.tsx`, `agent-stream/strategy-web.tsx`, `agent-stream/chat-find/index.web.tsx`, `agent-stream/chat-outline/rail.web.tsx` | `dock`, `dock-composer`, `composer`, `composer-tracks`, `scroll-controls`, `transcript`, `chat-find`; `publishComposerClearance()`.   |
| Sidebar and callouts | `left-sidebar.tsx`, `sidebar-callout.tsx`, `archived-agent-callout.tsx`, `subagents/parent/callout.tsx`                                                                                                                         | `sidebarMaterialColor()`; `banner`, `callout`.                                                                                        |
| Other floating       | `toast-host.tsx`, `download-toast.tsx`, `pane-find/index.tsx`, `desktop/browser/pane/index.electron.tsx`                                                                                                                        | `toast`, `popover`.                                                                                                                   |
| Desktop              | `packages/desktop/src/main.ts`, `packages/desktop/src/window/window-manager.ts`                                                                                                                                                 | `materialWindowOptions()`, `setupWindowMaterial()`, `updateMaterialBackground()`.                                                     |

Fork-only feature files (`agent-change-requests/section.tsx`, `side-chat/panel.tsx`) also carry slots; they are not upstream files and never conflict.

## After every merge

1. Check the hooks still exist. Compare the `hooks` output with the previous run. A hook that disappeared means upstream rewrote that component; re-add the `dataSet` or call on the new element.
2. Typecheck and lint: `npm run typecheck` and `npm run lint`.
3. Run the material smoke tests (about 2 minutes):

   ```bash
   cd packages/app
   npx playwright test e2e/browser/materials.spec.ts --project=browser
   ```

   Against the real app, they check the sidebar, the window and settings skeletons, floating chrome geometry, composer pills and their shadow room, the tab scrim, and text contrast on every surface when the App theme differs from the system appearance. A failure means a selector or hook lost its target. The specs locate some elements by upstream `data-testid` (`agent-chat-scroll`, `context-window-details`, `combobox-desktop-container`); the stylesheet does not. When upstream renames one, the locator fails before any material check runs: update the locator, not the layer.

4. If the merge touched any file in the hook list, compare pixels against the pre-merge revision. Capture on the old revision, then check on the new one:

   ```bash
   cd packages/app
   git checkout <pre-merge-sha>
   MATERIALS_VISUAL=1 E2E_GPU_COMPOSITING=1 MATERIALS_SNAPSHOT_DIR=/tmp/materials-snap \
     npx playwright test -c playwright.materials.config.ts e2e/browser/materials-visual.spec.ts --update-snapshots
   git checkout <merged-sha>
   MATERIALS_VISUAL=1 E2E_GPU_COMPOSITING=1 MATERIALS_SNAPSHOT_DIR=/tmp/materials-snap \
     npx playwright test -c playwright.materials.config.ts e2e/browser/materials-visual.spec.ts
   ```

   It covers forced macOS desktop and plain web, 1440 and 390 widths, light and dark, with conversation, menu, dialog and sidebar scenes, plus collapsed sidebar, diff pane, directory menu and settings at 1440. A difference is either an upstream design change, which you accept, or a lost hook, which you fix.

## Resolving conflicts

Expect about 5–7 hook conflicts per merge. A trial merge of one week of upstream (2026-11-08 to 2026-11-15) hit 10 material conflict blocks in 8 files, 9 of them on shared primitives upstream was rewriting; a 4–5 day merge window scales that down. Each conflict is one line to re-attach.

Upstream wins. Take upstream's version of the file, then re-attach the hook:

- A conflict on a `dataSet={MATERIAL_SLOTS.x}` line or a `@/fork/materials/*` import: take upstream, then add the attribute or import back on the equivalent element.
- Upstream moved or split a primitive: put the slot on the new primitive, not on each caller. One slot on a shared primitive replaces many on call sites.
- Upstream changed DOM structure inside a slotted surface: nothing to do unless the smoke tests fail. Stylesheet selectors only depend on fork slots and generic children (`div`, `svg`, `[role="button"]`).
- Never resolve a conflict by keeping fork-side changes to upstream logic. If the layer needs different behavior, add it in `fork/materials/` and call it from a one-line hook.

To preview conflicts before merging:

```bash
node scripts/fork/material-layer.mjs trial-merge HEAD
```

It runs `git merge-tree` in memory and prints conflicted files, the number of conflict blocks, and how many blocks touch the material layer.

To measure how much of upstream the layer modifies:

```bash
node scripts/fork/material-layer.mjs stat HEAD
```
