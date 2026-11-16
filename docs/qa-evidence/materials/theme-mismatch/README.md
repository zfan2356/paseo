# App theme against system appearance, pill shadow, settings skeleton

Before/after pairs: left is `main` at `484ac21f`, right is this change. Capture: Linux Chromium with SwiftShader GPU compositing, `--project=browser`, forced macOS desktop, 1440×900, scaled to 50% (pill crops 200%). The system appearance is `prefers-color-scheme` (`page.emulateMedia`); the App theme is the persisted `theme` setting.

## What changed

| Pair                                                      | Before                                                                                                  | After                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `darwin-app-dark-system-light.png`                        | Panel, sidebar, composer and header use the light palette under dark text: body text contrast 1.0:1     | Every surface uses the dark palette                                                        |
| `darwin-app-light-system-dark.png`                        | The reverse: dark surfaces under light-theme text                                                       | Every surface uses the light palette                                                       |
| `darwin-app-light-system-light.png`, `…-dark-system-dark` | Correct                                                                                                 | Unchanged                                                                                  |
| `zoom-darwin-light-pill.png`, `…-enhanced.png`            | The pill shadow is clipped to the pill's box by the track scroller: gray rectangles outside the corners | The shadow keeps the pill's radius. The enhanced pair stretches gray 200–255 to full range |
| `darwin-settings-light.png`, `darwin-settings-dark.png`   | Opaque settings sidebar with a right rule, an 8px floor strip at the window edge                        | Navigation on the floor; detail pane floats with the panel's gap and corners               |

## Root causes

- **Theme mismatch.** `<Materials />` mounts in `root-app.tsx` before `AppearanceProvider` applies the persisted theme. Its `withUnistyles` mapper passed the whole theme and read no field, so Unistyles never subscribed it to theme changes: the stylesheet kept the startup theme, which is the system appearance. On a Mac, window vibrancy also followed the system appearance: the desktop never set `nativeTheme.themeSource`.
- **Pill shadow.** The composer track is a horizontal `ScrollView`; its overflow clips to the 32px pill height.
- **Settings.** The settings screen renders its own sidebar (`surfaceSidebar`, 1px right border) inside the workspace panel, outside the `sidebar` and `panel` slots.

## Upstream hooks

Six lines against `484ac21f`, as `node scripts/fork/material-layer.mjs hooks` prints them:

| File                                            | Line                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/app/src/screens/settings-screen.tsx`  | `import { MATERIAL_SLOTS } from "@/fork/materials/slots";`                               |
| `packages/app/src/screens/settings-screen.tsx`  | `<View style={styles.container} dataSet={MATERIAL_SLOTS.settings}>` (attribute added)    |
| `packages/app/src/appearance/provider.tsx`      | `import { syncDesktopThemePreference } from "@/fork/materials/desktop-theme";`           |
| `packages/app/src/appearance/provider.tsx`      | `syncDesktopThemePreference();` after `applyTheme(...)`                                  |
| `packages/desktop/src/window/window-manager.ts` | `import { applyMaterialThemePreference } from "../fork/materials/window-material.js";`   |
| `packages/desktop/src/window/window-manager.ts` | `applyMaterialThemePreference(update);` first in the `paseo:window:updateChrome` handler |

## Regression coverage

In `e2e/browser/materials.spec.ts`, failing on `484ac21f` and passing here:

- `material surfaces follow the App theme against the system appearance (darwin)`: transcript, sidebar, header, composer and menu text at ≥ 4.5:1 in all four combinations, backgrounds composited down to the system appearance.
- `material stylesheet follows runtime theme changes (darwin)`: starts on Dark under a light system, then picks Light, Dark and System in Settings and turns the system dark. After each step the floor, the panel or settings detail pane, and the App's text share one scheme. `484ac21f` fails at the first step: Dark is selected and the floor and panel are light.
- `composer pills stay above the floating composer`: no clipping ancestor within the shadow's reach (12px above, 16px beside, 20px below).
- `window skeleton floats the workspace panel`: settings navigation shows the floor with no rule; the detail pane has the 8px gap, 12px left corners and shadow.

`material-controller.test.ts` covers the macOS `themeSource` sync: system, light and dark preferences, Auto when the system changes before the renderer reports, invalid payloads, and no effect off macOS. `desktop-theme.test.ts` covers the preference mapping. The runtime test also checks the `themePreference` each step sends and that the floor stays translucent (vibrancy on) for Dark on a light system.

`materials-visual.spec.ts` gains a `1440-settings` scene. Against the `484ac21f` baseline, all other 56 scenes stay pixel-identical (`maxDiffPixels: 0`); the four settings scenes change as above. The pill shadow change is below the default per-pixel threshold, so the conversation scenes do not register it; the geometry assertion does.

## Mac verification still needed

The forced-macOS captures have no vibrancy and no `nativeTheme`. Check on a Mac:

- App Dark with macOS Light, and App Light with macOS Dark: the sidebar and floor take the App's scheme, not the system's.
- Switching macOS appearance while the App is on Dark or Light keeps the App's scheme; with the App on Auto the window follows macOS.
- With the App on Auto, switching macOS appearance switches the vibrancy and the text together; switching the App from Dark to Auto under a light system returns to light.
- Native context menus and message boxes take the App's scheme once `themeSource` is set.
- The `2 in progress` pill in light mode has a rounded shadow and no gray blocks.
- Settings matches the workspace skeleton beside vibrancy.
