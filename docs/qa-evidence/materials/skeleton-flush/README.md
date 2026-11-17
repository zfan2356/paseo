# Window skeleton: flush panel edges

Before/after pairs from `e2e/browser/materials-visual.spec.ts`. Left is `main` at `d7282f99`, right is this change. Pairs are scaled to 50%. Capture: Linux Chromium with SwiftShader GPU compositing, `--project=browser`, forced macOS desktop (`darwin-*`) and plain web (`web-*`), 1440 wide.

## What changed

| Scene                                 | Change                                                                                                                                             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*-1440-conversation`                 | Sidebar pinned: the panel's top, right and bottom edges meet the window; the 8px gap, left corners, left border and shadow stay beside the sidebar |
| `*-1440-sidebar-collapsed`            | Sidebar collapsed: the panel is flush on all four sides, with no corners, border or shadow                                                         |
| `zoom-*-top-left`, `zoom-*-top-right` | 2× crops of the top 120px: before on top, after below                                                                                              |

Every 1440 scene in the visual matrix changes the same way: conversation, menu, dialog, sidebar, sidebar collapsed, diff, directory menu and directory select. All 390 scenes stay pixel-identical to `main` (`maxDiffPixels: 0`).

## Mac verification still needed

The forced-macOS captures have no window vibrancy and no window corner clipping. Check on a Mac: the window's own corners round the panel's right side, and the traffic lights stay clear with the sidebar collapsed.
