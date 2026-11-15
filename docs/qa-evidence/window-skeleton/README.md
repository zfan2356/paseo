# Window skeleton preview — WORK-419

Preview of the rounded workspace panel defined in [design.md §14](../../design.md#14-window-skeleton) and the layer table in [§15](../../design.md#15-layers-and-materials). The [polish inventory](polish-inventory.md) lists the remaining surfaces; none of it is implemented here.

## Captures

Real Chromium captures at DPR 1, 900px tall, from `packages/app/e2e/browser/window-skeleton-capture.spec.ts` against an isolated e2e daemon. Each image shows main `8400a809` on the left and this branch on the right (reduced-transparency and focus-mode images show this branch only), with the same fixture and scroll rule. Project names are random per run. Images are 256-colour PNGs to keep the repository small, so soft shadows show banding that the app does not have.

**Simulated:** every `mac-*` capture forces the macOS branch on Linux by installing a `darwin` desktop bridge before the app boots, and paints a blurred wallpaper under the transparent body to stand in for window vibrancy. It renders the real `getIsElectronMac()` code path, not real NSVisualEffectView vibrancy, traffic lights or SF Pro. `web-*` captures are the browser (and Windows/Linux desktop) path with an opaque floor. 390px captures are responsive web, not native iOS/Android.

| Scene                  | Web light                                                      | Web dark                                                      | macOS light (simulated)                                        | macOS dark (simulated)                                        |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| 1440 conversation      | [compare](compare/web-light-1440-conversation.png)             | [compare](compare/web-dark-1440-conversation.png)             | [compare](compare/mac-light-1440-conversation.png)             | [compare](compare/mac-dark-1440-conversation.png)             |
| 1440 sidebar collapsed | [compare](compare/web-light-1440-sidebar-collapsed.png)        | [compare](compare/web-dark-1440-sidebar-collapsed.png)        | [compare](compare/mac-light-1440-sidebar-collapsed.png)        | [compare](compare/mac-dark-1440-sidebar-collapsed.png)        |
| 1440 menu              | [compare](compare/web-light-1440-menu.png)                     | [compare](compare/web-dark-1440-menu.png)                     | [compare](compare/mac-light-1440-menu.png)                     | [compare](compare/mac-dark-1440-menu.png)                     |
| 1440 dialog            | [compare](compare/web-light-1440-dialog.png)                   | [compare](compare/web-dark-1440-dialog.png)                   | [compare](compare/mac-light-1440-dialog.png)                   | [compare](compare/mac-dark-1440-dialog.png)                   |
| 1440 reduced transp.   | [this branch](compare/web-light-1440-reduced-transparency.png) | [this branch](compare/web-dark-1440-reduced-transparency.png) | [this branch](compare/mac-light-1440-reduced-transparency.png) | [this branch](compare/mac-dark-1440-reduced-transparency.png) |
| 1440 focus mode        | [this branch](compare/web-light-1440-focus-mode.png)           | [this branch](compare/web-dark-1440-focus-mode.png)           | —                                                              | —                                                             |
| 390 conversation       | [compare](compare/web-light-390-conversation.png)              | [compare](compare/web-dark-390-conversation.png)              | [compare](compare/mac-light-390-conversation.png)              | [compare](compare/mac-dark-390-conversation.png)              |
| 390 menu               | [compare](compare/web-light-390-menu.png)                      | [compare](compare/web-dark-390-menu.png)                      | [compare](compare/mac-light-390-menu.png)                      | [compare](compare/mac-dark-390-menu.png)                      |
| 390 dialog             | [compare](compare/web-light-390-dialog.png)                    | [compare](compare/web-dark-390-dialog.png)                    | [compare](compare/mac-light-390-dialog.png)                    | [compare](compare/mac-dark-390-dialog.png)                    |

The 390px pairs differ only in content (random project name, timestamps): compact layouts keep the full-screen workspace. The bottom-left lightning badge in some captures is the Expo dev LogBox toast, present only in Metro dev bundles ([inventory item 7](polish-inventory.md#7-bottom-left-floating-badge)).

Reproduce:

```bash
cd packages/app
E2E_SKELETON_CAPTURE=1 E2E_SKELETON_OUT=/tmp/skeleton E2E_GPU_COMPOSITING=1 \
  npx playwright test --project=browser e2e/browser/window-skeleton-capture.spec.ts
```

## Regression

`packages/app/e2e/browser/materials.spec.ts` › `window skeleton floats the workspace panel` runs for both the forced macOS branch and plain web. At 1440 it asserts an 8px gap between sidebar and panel, 8px insets to the top, right and bottom edges, a 12px radius, a 1px panel border and no sidebar right border. At 390 it asserts the panel slot is absent.

## Verification gaps

- Real macOS: vibrancy strength under the 8px frame, traffic-light vertical position once the collapsed-sidebar header moves down by the inset, and native full screen.
- Windows/Linux desktop: the custom window controls in the top-right corner now sit over the panel's top inset; not captured.
- Focus mode is captured and asserted on the web path only, not under the forced macOS branch.
