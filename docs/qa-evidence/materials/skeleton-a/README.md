# Window skeleton A and P0 polish

Before/after pairs from `e2e/browser/materials-visual.spec.ts`: left is `main` at `d65ca858`, right is this change. Each pair is scaled to 50%; the `p0-*` crops are full size. Capture: Linux Chromium with SwiftShader GPU compositing, `--project=browser`, forced macOS desktop (`darwin-*`) and plain web (`web-*`).

## What changed

| Scene                                        | Change                                                                                                   |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| All 1440 scenes                              | The workspace floats as a 12px-radius panel 8px inside the window on the sidebar floor; no sidebar line  |
| `*-1440-sidebar-collapsed`                   | The panel keeps its four insets with the sidebar hidden                                                  |
| `*-1440-dialog`, `*-1440-menu`               | Only the skeleton behind the scrim moves; the dialog and menu are unchanged                              |
| `p0-6-pill-row-*`                            | The diff-stat pill takes the hint material: 96% fill, 8px blur, hint border and shadow                   |
| `p0-8-diff-header`                           | The three-line path block is gone and the header keeps one divider                                       |
| `p0-8-*-directory-select`                    | The checkout path and the shared-changes hint head the directory menu: a popover at 1440, a sheet at 390 |
| `p0-2-directory-menu`                        | Every directory action has a leading icon and starts its title on one rail; `+` dropped from the label   |
| 390 conversation, menu, dialog, sidebar (16) | Pixel-identical to `main` (`maxDiffPixels: 0`); the 390 diff and directory-select scenes change as above |

## Mac verification still needed

The forced-macOS captures run in Chromium on Linux, so window vibrancy is absent. Check on a Mac: the floor tint over vibrancy in both schemes, the panel corner next to the traffic lights with the sidebar collapsed, full screen, and Reduce Transparency.
