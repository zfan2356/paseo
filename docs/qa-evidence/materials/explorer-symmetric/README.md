# Docked Explorer on the floor, centred resize handles

Before/after pairs: left half is `main` at `e30992ca`, right half is this change. Capture: Linux Chromium with SwiftShader GPU compositing, `--project=browser`, 1440×900 scaled to 50%. `darwin` forces the Electron macOS bridge (translucent floor, no real vibrancy); `web` is plain browser web. The magenta squares are the visual spec's masks.

## Pairs

| Sidebars        | Files                                         | Change                                                                                                                          |
| --------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Left only       | `{darwin,web}-{light,dark}-left-only.png`     | None                                                                                                                            |
| Right only      | `{darwin,web}-{light,dark}-right-only.png`    | The Explorer moves off the panel onto the floor; the workspace keeps an 8px gap and rounded right corners                       |
| Both            | `{darwin,web}-{light,dark}-both.png`          | The workspace column floats between the two sidebars with 8px on each side and four rounded corners                             |
| None            | `{darwin,web}-{light,dark}-none.png`          | None                                                                                                                            |
| Divider zoom 4× | `zoom-{darwin,web}-{light,dark}-dividers.png` | Both open, the left and right gaps. Before: a 1px line between the panel and an opaque Explorer. After: the floor on both sides |

`materials-visual.spec.ts` gains `1440-explorer` and `1440-both-sidebars`. Against the `e30992ca` baseline, the scenes with the Explorer docked change as above (`explorer`, `both-sidebars`, `diff`, `directory-menu`, `directory-select`); 390px, settings and the scenes without the Explorer stay within anti-aliasing noise (at most 2 levels on a few hundred pixels at the left gap, and 4 pixels on the tab overflow button on web dark).

## Root causes

- **Explorer.** `WorkspacePanel` wraps the whole workspace screen, and the Explorer renders inside it as the second child of the workspace row. It painted `surfaceSidebar` inside the floating panel, and its web resize handle draws a 1px `border` line.
- **Sidebar handle.** The pointer handle straddles the sidebar edge (5px each side), while the visual divider is the panel edge 8px further right. Only the 5px inside the sidebar took a drag, for two reasons that also hold on upstream `3d30aaec`: the docked panel's `overflow: hidden` (`mobile-panels/presentation.tsx`, two ancestors) clips the outer half, and the workspace branch, later in the DOM, paints over it even without the clip. In the fork the divider also sits 8px further right than on upstream.

## Upstream hooks

Two lines against `e30992ca`, as `node scripts/fork/material-layer.mjs hooks` prints them:

| File                                                      | Line                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | `import { MATERIAL_SLOTS } from "@/fork/materials/slots";`         |
| `packages/app/src/screens/workspace/workspace-screen.tsx` | `dataSet={MATERIAL_SLOTS.workspaceRow}` on the `threePaneRow` view |

## Regression coverage

`docked Explorer mirrors the sidebar on the floor` in `e2e/browser/materials.spec.ts` (darwin and web), failing on `e30992ca` and passing here:

- Sidebar only: the panel sits 8px off the sidebar; the sidebar handle's hit area centres on the gap and a pointer at the gap centre lands on it.
- Both open: the column is 8px off each sidebar, flush top and bottom, 12px on all four corners, 1px border on both sides, with a shadow; no opaque layer between the Explorer and the floor; both handles centred on their gaps and hittable there.
- Explorer only: flush left with square left corners, floating right.
- Reduce Transparency keeps the geometry; focus mode (web) drops the panel and restores it; 390px has no panel.

## Mac verification still needed

The forced-macOS captures have no window vibrancy. Check on a Mac:

- With enough Explorer tabs to scroll, the tab rail's overflow fades: they take a hex `surfaceSidebar` through `withUnistyles`, not the CSS variable, so they may show as opaque gradients over the floor.
- With both sidebars open, the Explorer shows the same vibrancy as the left sidebar, with no tint step between its tab rail, Files and Changes.
- The workspace column's right corners and the window's right edge meet cleanly, top and bottom.
- Dragging on either divider resizes the sidebar on that side, and the hover highlight sits in the gap.
- Toggling the Explorer and the sidebar does not flash or move the Explorer toggle in the top-right slot.
