# Fork design: materials

This fork adds glass materials and elevation to web and desktop. Native iOS and Android keep upstream rendering. Read [`docs/design.md`](../design.md) first; this doc lists only where the fork departs from it. The layer's code and hooks are in [SYNC.md](SYNC.md).

## Where the code lives

- Tokens: `packages/app/src/fork/materials/tokens.ts` (`MATERIAL`). Upstream `theme.ts` stays untouched.
- Slot names: `packages/app/src/fork/materials/slots.ts` (`MATERIAL_SLOTS`). A slot is a `data-material` attribute that the fork sets on a component. Hooks that extend an existing upstream `dataSet` or DOM attribute write the value inline; `node scripts/fork/material-layer.mjs hooks` lists both forms.
- Stylesheet: `packages/app/src/fork/materials/styles.web.tsx`. It installs one `<style data-material-styles>` and is a no-op on native.
- macOS window vibrancy: `packages/desktop/src/fork/materials/`.

Selectors target fork slots only. Inside a slot they may use generic elements (`div`, `svg`, `textarea`, `[role="button"]`), never an upstream `testID` or a path of upstream components. When you need a new surface, add a slot to `MATERIAL_SLOTS`, set it on the shared primitive, and add the selector. Don't style a surface by its upstream DOM path: upstream refactors silently break it.

## Elevation

Each slot belongs to one elevation level (`MATERIAL.elevation` in `tokens.ts`). The level sets radius, border, shadow, opacity floor and blur ceiling. `FloatingSurface` tags `tooltip` when `role="tooltip"` and `popover` otherwise, so combobox, hover cards and other anchored panels take the popover level without their own slot.

| Level   | Slots                                                                        | Radius | Material                             |
| ------- | ---------------------------------------------------------------------------- | ------ | ------------------------------------ |
| hint    | `tooltip`, `toast`, `secondary`                                              | 10     | protected: ≥ 96% opacity, blur ≤ 8px |
| popover | `menu`, `popover`, `autocomplete`, `banner`, `callout`, `secondary-expanded` | 16     | glass                                |
| modal   | `composer`, `dialog`, `sheet`, `fullscreen`                                  | 24     | glass                                |

Glass is `surface` at 76% opacity with `blur(20px) saturate(1.3)`. Under `prefers-reduced-transparency: reduce` every material is the opaque `surface` with no blur.

The workspace chrome (`chrome`, `header`) is glass without border or shadow. On an agent tab it floats over the transcript, and the transcript reserves `--paseo-chrome-clearance` at the top and `--paseo-composer-clearance` at the bottom. Scroll controls and composer pills lift by the composer clearance.

On Electron macOS the window is transparent with `sidebar` vibrancy, and the sidebar uses `--paseo-sidebar-material` (74% `surface`). Other platforms keep the opaque `content` background.

## Upstream clauses this overrides

These apply on web and desktop only. Native follows upstream.

| Upstream clause                                                                | Fork rule                                                                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| §5 Borders: pane chrome uses a single bottom border.                           | The workspace chrome and headers have no border or shadow. The glass edge separates them from content.                                     |
| §6 Pickers: `AdaptiveModalSheet` sits on `surface0`.                           | Dialogs and sheets use the modal material: glass `surface`, 24px radius, modal shadow, at most 560px wide.                                 |
| §11 States: sidebar callouts are top-border-only with full-width actions.      | Sidebar callouts are banner cards: popover material, 12px margin and gap, 16px padding; text actions use the `control` fill.               |
| §3 Hierarchy: placeholders use `foregroundMuted` from the theme.               | The composer placeholder uses the material palette's `foregroundMuted`.                                                                    |
| §4 Buttons: toolbar glyphs follow `toolbarGlyphsFor` and the icon size tokens. | Fixed-size glyphs in header, menu and banner are 16px; composer glyphs are 20px; all at 1.5 stroke. Percentage-sized SVGs keep their size. |
| §14 Forbidden: no hardcoded hex outside the palette.                           | The material palette in `tokens.ts` is the exception, the same way the identity color table is upstream.                                   |

Typography inside chrome, menu, banner, composer and dialog uses the system UI stack in `MATERIAL.font`.

## Evidence

[`docs/qa-evidence/materials/README.md`](../qa-evidence/materials/README.md) records the original coverage and the Mac verification gaps.
