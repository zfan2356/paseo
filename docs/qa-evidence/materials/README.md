# Default desktop materials — WORK-408

The selected medium recipe is now the Web/desktop default: 76% tint and 20px blur, with the approved L1/L2/L3 borders, shadows and radii. There is no strength selector, material localStorage setting or launch flag. macOS main windows use sidebar vibrancy; Web, Linux and Windows keep an opaque sidebar. Reduce Transparency makes raised surfaces opaque and removes blur. Native rendering is unchanged.

## Visual evidence

These are real Chromium captures at 1440×1000 and 390×1000, DPR 1. The narrow captures are responsive Web, not native iOS/Android. New captures show the real opaque browser sidebar; no native vibrancy is simulated. Images inside the conversation are authored test content rendered by the real Markdown engine. Header/composer overlap is asserted in the wide captures.

The main comparison is captured from `17327eec7` (including WORK-396) with the same daemon fixture, conversation and scroll rule. Baseline capture source is [preserved](baseline-spec.txt); only app production sources are restored to main for that run, then the implementation is restored. Scroll geometry changes between the two layouts, so the same proportional scroll position need not show the identical paragraph.

| Theme / width | Conversation                                                                              | Attachment menu                                                           | Dialog                                                                        | Sidebar                                                                          |
| ------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Light / 1440  | [main](main-light-1440-conversation.png) → [default](light-1440-conversation-default.png) | [main](main-light-1440-menu.png) → [default](light-1440-menu-default.png) | [main](main-light-1440-dialog.png) → [default](light-1440-dialog-default.png) | [main](main-light-1440-sidebar.png) → [default](sidebar-light-1440-selected.png) |
| Dark / 1440   | [main](main-dark-1440-conversation.png) → [default](dark-1440-conversation-default.png)   | [main](main-dark-1440-menu.png) → [default](dark-1440-menu-default.png)   | [main](main-dark-1440-dialog.png) → [default](dark-1440-dialog-default.png)   | [main](main-dark-1440-sidebar.png) → [default](sidebar-dark-1440-selected.png)   |
| Light / 390   | [main](main-light-390-conversation.png) → [default](light-390-conversation-default.png)   | [main](main-light-390-menu.png) → [default](light-390-menu-default.png)   | [main](main-light-390-dialog.png) → [default](light-390-dialog-default.png)   | [main](main-light-390-sidebar.png) → [default](sidebar-light-390-selected.png)   |
| Dark / 390    | [main](main-dark-390-conversation.png) → [default](dark-390-conversation-default.png)     | [main](main-dark-390-menu.png) → [default](dark-390-menu-default.png)     | [main](main-dark-390-dialog.png) → [default](dark-390-dialog-default.png)     | [main](main-dark-390-sidebar.png) → [default](sidebar-dark-390-selected.png)     |

Banner detail: [light](detail-light-banner-default.png), [dark](detail-dark-banner-default.png). Reduced-transparency captures: [light wide](light-1440-reduced-transparency.png), [dark wide](dark-1440-reduced-transparency.png), [light narrow](light-390-reduced-transparency.png), [dark narrow](dark-390-reduced-transparency.png). Sidebar context menu: [wide](sidebar-light-1440-context.png), [compact sheet](sidebar-light-390-menu.png).

The approved visual study remains in [PR #19](https://github.com/zfan2356/paseo/pull/19). Its simulated Mac wallpaper is historical evidence; the current captures above do not simulate vibrancy. Linux uses DejaVu Sans and its installed fallbacks, not SF Pro.

## Elevation inventory

[Generated inventory](floating-inventory.json): 128 caller files, zero unmapped slots, zero deferred files. Regenerate with `node docs/qa-evidence/materials/inventory.mjs`. The five previously deferred files (`left-sidebar.tsx`, `sidebar-workspace-list.tsx`, `session-navigation/actions.tsx`, `session-navigation/menu.tsx`, `session-navigation/sidebar.tsx`) inherit the shared menu/modal/hover-card renderers; none has a private floating renderer to patch. The session card itself receives a web-only 8px outer inset and 12px radius; hover/state/menu handlers remain owned by session navigation.

| Tier | Radius | Owners                                                                                                   |
| ---- | -----: | -------------------------------------------------------------------------------------------------------- |
| L1   |   10px | Tooltip, toast, collapsed linked requests; protected 96% tint / 8px blur                                 |
| L2   |   16px | Menus, context menus, comboboxes, autocomplete, hover cards, banners, callouts, expanded linked requests |
| L3   |   24px | Dialogs, sheets, composer, fullscreen image/Mermaid surfaces, command center and add-project flow        |

FloatingSurface defaults to L2; explicit dialog/fullscreen markers select L3. Menu and combobox compact presentations inherit the L3 sheet background. Native sheet adapters remain unchanged. The catalog captures all nine renderer families in both themes (`floating-*-default.png`). This proves renderer families, not every business dialog individually. The catalog records the existing HostPicker nested-button warning in both themes; [raw console records](floating-console.json) contain no uncaught page errors.

## Scroll performance

[Raw samples](frames.json), [environment/GPU](environment.json), [paint/ancestor properties](paint.json). Three paired trials alternate blur on/off order; only `backdrop-filter` is overridden. Each trial scrolls the same 18-section illustrated transcript for 180 animation frames, discards 30 warmup intervals and asserts more than 60 distinct scroll positions plus the effective filter state. GPU compositing is enabled through ANGLE/SwiftShader.

| Blur | Intervals | Median |    P95 | Maximum |
| ---- | --------: | -----: | -----: | ------: |
| Off  |       450 | 16.7ms | 16.8ms |  16.8ms |
| On   |       450 | 16.7ms | 16.8ms |  33.3ms |

These are requestAnimationFrame intervals and synchronous scroll-write samples on a shared Linux VM. They do not measure GPU execution time or prove zero blur cost on Mac.

## Validation

Commands and terminal results are retained in the adjacent logs. No full local suite was run. The browser harness owns isolated daemons and never restarts port 6767.

- [Window regression](window-tests.txt): 18 passed, including macOS activation policy, startup/live reduced transparency, latest opaque theme color, listener cleanup and non-Mac opacity.
- [Final material browser](browser-final.txt): conversation, attachment menu, dialog/sheet, theme/viewport matrix, reduced-transparency assertions and scroll samples.
- [Final catalog/sidebar run](browser-final-attempt1.txt): catalog and sidebar tests passed; its first test failed because the new assertion queried only a desktop dialog at 390px. The selector now covers the actual sheet, and the final material run above verifies the correction. The initial complete catalog run is also retained in [browser.txt](browser.txt).
- [Sidebar browser](sidebar-browser.txt): inset/selected state, status, right-click, pin/unpin, compact sheet and actual hover archive; existing session toolbar/menu regressions.
- [Typecheck](typecheck.txt), [lint](lint.txt), [format](format.txt), [format check](format-check.txt).
- [Sheet host](sheet-tests.txt): 6 passed.
- [Main baseline capture](baseline-browser.txt): passed; 16 real comparison images.
- [Server/app dependencies](build-server.txt), [desktop main](build-desktop-main.txt), [desktop package](build-desktop.txt), [final renderer export/repack](build-desktop-final.txt).
- [Native code evidence](native-code.txt): unchanged native composer files and passthrough palette helpers; native Materials returns null. Shared markers carry no native style and DOM measurements are web-guarded. Zero-linked-request hiding is web-only.

Reproduce material coverage with:

```sh
E2E_GPU_COMPOSITING=1 E2E_PERFORMANCE=1 npm run test:e2e --workspace=@getpaseo/app -- materials.spec.ts
```

Set `E2E_CHROMIUM_EXECUTABLE_PATH` when using an installed Chromium. Performance mode disables trace/video recording; it does not change product rendering.

## Platform limits and Mac follow-up

Linux Chromium is exercised; Linux desktop is built. Windows and macOS policy paths are unit-tested. Native iOS/Android paths have code evidence only. No Mac native window was launched on this Linux host.

On Mac, verify desktop wallpaper sampling through the sidebar, activation/deactivation, live Reduce Transparency changes in both themes, Spaces/fullscreen, native titlebar dragging, Retina borders, font fallback and GPU presentation timing. Desktop updates remain user-owned. This task does not merge or deploy.
