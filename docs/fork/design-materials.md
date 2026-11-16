# Fork design: materials

This fork adds glass materials and elevation to web and desktop. Native iOS and Android keep upstream rendering. Read [`docs/design.md`](../design.md) first; this doc lists only where the fork departs from it. The layer's code and hooks are in [SYNC.md](SYNC.md).

## Where the code lives

- Tokens: `packages/app/src/fork/materials/tokens.ts` (`MATERIAL`). Upstream `theme.ts` stays untouched.
- Slot names: `packages/app/src/fork/materials/slots.ts` (`MATERIAL_SLOTS`). A slot is a `data-material` attribute that the fork sets on a component. Hooks that extend an existing upstream `dataSet` or DOM attribute write the value inline; `node scripts/fork/material-layer.mjs hooks` lists both forms.
- Stylesheet: `packages/app/src/fork/materials/styles.web.tsx`. It installs one `<style data-material-styles>` and is a no-op on native.
- Workspace panel wrapper: `packages/app/src/fork/materials/workspace-panel.web.tsx`. Native renders the upstream single view.
- macOS window vibrancy: `packages/desktop/src/fork/materials/`.

The material stylesheet follows the selected app theme, including saved plugin themes and
live system-theme changes. Read `colorScheme` and `surfaceSidebar` inside the `withUnistyles`
mapping, before its subscription is installed. Passing the theme proxy through to an effect
leaves the material layer on the startup system palette while text adopts the saved palette.
`materials.spec.ts` covers opposite system/app themes and theme changes without reloading.

Composer placeholders keep the selected theme's `foregroundExtraMuted`; the material
layer does not override text-input placeholder colors.

Selectors target fork slots only. Inside a slot they may use generic elements (`div`, `svg`, `textarea`, `[role="button"]`), never an upstream `testID` or a path of upstream components. When you need a new surface, add a slot to `MATERIAL_SLOTS`, set it on the shared primitive, and add the selector. Don't style a surface by its upstream DOM path: upstream refactors silently break it.

## Elevation

Each slot belongs to one elevation level (`MATERIAL.elevation` in `tokens.ts`). The level sets radius, border, shadow, opacity floor and blur ceiling. `FloatingSurface` tags `tooltip` when `role="tooltip"` and `popover` otherwise, so combobox, hover cards and other anchored panels take the popover level without their own slot.

| Level   | Slots                                                                        | Radius | Material                             |
| ------- | ---------------------------------------------------------------------------- | ------ | ------------------------------------ |
| hint    | `tooltip`, `toast`, `secondary`, composer pills                              | 10     | protected: ≥ 96% opacity, blur ≤ 8px |
| popover | `menu`, `popover`, `autocomplete`, `banner`, `callout`, `secondary-expanded` | 16     | glass                                |
| modal   | `composer`, `dialog`, `sheet`, `fullscreen`                                  | 24     | glass                                |

Composer pills are the buttons inside `composer-tracks`. They float over the transcript above the composer, so they take the hint fill, border, shadow and blur but keep their own pill radius. The pills sit in a horizontal scroller that clips to the pill height, which cuts the shadow into gray rectangles at the corners. The stylesheet pads that scroller by `MATERIAL.elevation.hint.shadowReach` and cancels the padding with negative margins, so the shadow keeps the pill's radius and the layout does not move.

Glass is `surface` at 76% opacity with `blur(20px) saturate(1.3)`. Under `prefers-reduced-transparency: reduce` every material is the opaque `surface` with no blur.

The workspace chrome (`chrome`, `header`) is glass without border or shadow. On an agent tab it floats over the transcript, and the transcript reserves `--paseo-chrome-clearance` at the top and `--paseo-composer-clearance` at the bottom. Scroll controls and composer pills lift by the composer clearance.

On Electron macOS the window is transparent with `sidebar` vibrancy, and the sidebar uses `--paseo-sidebar-material` (74% `surface`). Other platforms keep the opaque `content` background.

Vibrancy samples the native appearance, so the desktop sets `nativeTheme.themeSource` from the user's theme choice. After `AppearanceProvider` applies a theme, `syncDesktopThemePreference()` (`fork/materials/desktop-theme.ts`) sends `themePreference` on the `updateChrome` IPC: `system` for Auto, otherwise the chosen theme's scheme, plugin themes included. The desktop applies it on macOS only. Send the preference, never a scheme inferred from colors: Auto has to stay on `system`, because a pinned `themeSource` also pins the renderer's `prefers-color-scheme`, and Auto would then never follow the system again.

## Window skeleton

On wide web and desktop layouts the sidebar material is the window's floor and the workspace is one panel that meets the window's top, right and bottom edges. It floats off the floor only beside a docked sidebar: the pinned app sidebar on the left, the docked Explorer on the right. The two sides are symmetric. There is one skeleton; there is no switch.

- **Floor.** The pinned sidebar, the docked Explorer and the gaps beside the panel share `--paseo-floor`: the sidebar material with `MATERIAL.panel.floorShade` black mixed in, so the panel reads as raised in both schemes. On Electron macOS the sidebar material is translucent over window vibrancy. Elsewhere it is the opaque `surfaceSidebar`.
- **Panel.** The workspace (tabs and panes) is one panel filled with opaque `MATERIAL.<scheme>.content`. Its top and bottom edges always touch the window; on Electron macOS the window's own corners round the side that meets the window. Beside each docked sidebar it keeps `MATERIAL.panel.inset` (8px), `MATERIAL.panel.radius` (12px) on the two corners on that side, `MATERIAL.panel.border` on that edge and `MATERIAL.panel.shadow`.
- **Explorer.** While the Explorer is docked open, the `panel` slot and every layer down to the `workspace-row` slot go clear, and the workspace column (the row's first child) takes the panel's fill, corners, border and shadow. The Explorer's tab rail, Files and Changes keep upstream `surfaceSidebar` in code; the stylesheet sets `--colors-surface-sidebar: transparent` inside the Explorer, so every surface that reads it lets the floor through once. Its glass `header` goes clear too. The Explorer's resize separator renders only while it is docked open on the active workspace, so the stylesheet uses it as the open-state signal instead of a hook.
- **No dividing line.** The pinned sidebar has no right border, and the Explorer's resize handle draws no line. The floor and the panel edge separate the regions.
- **Resize handles.** Each handle's hit area centres on its 8px gap, where the panel edge reads as the divider, and covers the whole gap. The sidebar handle is the sidebar slot's last child. Two things hide its outer half: the docked panel's `overflow: hidden` in upstream `mobile-panels/presentation.tsx`, and the workspace branch, which comes later in the DOM and paints over it (react-native-web gives every view `z-index: 0`, so raising the handle's `z-index` cannot escape its ancestors). The stylesheet switches the sidebar's ancestors to `overflow: visible`, and sets `pointer-events: none` on the panel frame and its wrappers with `auto` on the panel itself, so pointers in the gap fall through to the handle. Don't fix it with `z-index` on the sidebar branch: that hides the panel's shadow on the sidebar.
- **Slots.** `panel-frame` and `panel` come from `WorkspacePanel` in `app/_layout.tsx`; `sidebar` is set on the pinned sidebar in `left-sidebar.tsx`; `workspace-row` is the row holding the workspace column and the Explorer in `workspace-screen.tsx`. Both wrappers always render and only their slots change, so toggling focus mode or the sidebar never remounts the workspace.
- **Settings.** The desktop settings screen carries the `settings` slot and takes the same skeleton inside the workspace panel: the panel and its wrappers go clear, the settings navigation sits on the floor with no right border, and the detail pane floats off it with the panel's gap, corners, border and shadow. The stylesheet reaches the two halves as `[role="navigation"]` and the last child of the settings row.
- **Pinned detection.** The left inset, corners, border and shadow apply under `html:has([data-material="sidebar"])`. A collapsed sidebar switches to the overlay presentation, which carries no `sidebar` slot, so the panel goes flush without an extra hook.

| State                                | Behavior                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Sidebar pinned                       | Floor under the sidebar; 8px gap and rounded left corners beside it; top, right and bottom flush |
| Explorer docked                      | Floor under the Explorer; 8px gap and rounded right corners beside it                            |
| Both docked                          | The workspace column floats with 8px on each side and four rounded corners                       |
| Sidebar collapsed, Explorer closed   | Panel flush on all four sides; the header keeps its traffic-light clearance                      |
| Narrow wide window (overlay sidebar) | Panel flush; the overlay sidebar keeps its own surface and slides over it                        |
| Settings (wide)                      | Navigation on the floor; detail pane floats like the panel beside the pinned sidebar             |
| Workspace focus mode                 | No panel and no Explorer: the workspace fills the window                                         |
| macOS full screen                    | Same as windowed                                                                                 |
| Compact (`md` and below, e.g. 390px) | Unchanged full-screen workspace; the Explorer stays an overlay sheet                             |
| Native iOS and Android               | Unchanged upstream rendering                                                                     |
| Off macOS                            | Opaque floor; same geometry, border and shadow                                                   |
| Reduce Transparency                  | The sidebar material becomes opaque `surface`, so the floor turns opaque                         |

## Upstream clauses this overrides

These apply on web and desktop only. Native follows upstream.

| Upstream clause                                                                                                             | Fork rule                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §9 Responsiveness: the pinned sidebar sits beside the content pane.                                                         | The content pane is one panel, flush with the window and inset from the sidebar floor ([Window skeleton](#window-skeleton)).                                                                  |
| §5 Borders: the pinned sidebar meets the workspace at a 1px right border.                                                   | No line between the sidebar and the workspace. The panel takes a border and a shadow; pane chrome inside it keeps one border and no shadow.                                                   |
| §5 Borders and §9: the docked Explorer is a `surfaceSidebar` dock that meets the workspace at its resize handle's 1px line. | The Explorer sits on the floor, mirroring the pinned sidebar: no line, an 8px gap, and the workspace column floats between them. The §9 Explorer toggle slot and width budgets are unchanged. |
| §5 Borders: pane chrome uses a single bottom border.                                                                        | The workspace chrome and headers have no border or shadow. The glass edge separates them from content.                                                                                        |
| §6 Pickers: `AdaptiveModalSheet` sits on `surface0`.                                                                        | Dialogs and sheets use the modal material: glass `surface`, 24px radius, modal shadow, at most 560px wide.                                                                                    |
| §11 States: sidebar callouts are top-border-only with full-width actions.                                                   | Sidebar callouts are banner cards: popover material, 12px margin and gap, 16px padding; text actions use the `control` fill.                                                                  |
| §4 Buttons: toolbar glyphs follow `toolbarGlyphsFor` and the icon size tokens.                                              | Fixed-size glyphs in header, menu and banner are 16px; composer glyphs are 20px; all at 1.5 stroke. Percentage-sized SVGs keep their size.                                                    |
| §14 Forbidden: no hardcoded hex outside the palette.                                                                        | The material palette in `tokens.ts` is the exception, the same way the identity color table is upstream.                                                                                      |

Typography inside chrome, menu, banner, composer and dialog uses the system UI stack in `MATERIAL.font`.

## Evidence

[`docs/qa-evidence/materials/README.md`](../qa-evidence/materials/README.md) records the original coverage and the Mac verification gaps. [`skeleton-a/README.md`](../qa-evidence/materials/skeleton-a/README.md) records the floating-panel skeleton and its own Mac checks. [`skeleton-flush/README.md`](../qa-evidence/materials/skeleton-flush/README.md) records the move to flush top, right and bottom edges. [`theme-mismatch/README.md`](../qa-evidence/materials/theme-mismatch/README.md) records App theme against system appearance, the pill shadow and the settings skeleton. [`explorer-symmetric/README.md`](../qa-evidence/materials/explorer-symmetric/README.md) records the Explorer on the floor and the centred resize handles.
