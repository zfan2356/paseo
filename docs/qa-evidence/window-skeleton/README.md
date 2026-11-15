# Window skeleton preview — WORK-419

Preview of the two window skeletons in [design.md §14](../../design.md#14-window-skeleton) and the layer table in [§15](../../design.md#15-layers-and-materials):

- **A — floating workspace** (default). The sidebar material is the window's floor; the workspace floats on it as one rounded panel.
- **B — floating sidebar.** The workspace fills the window; the sidebar is an inset glass panel and header controls sit in glass capsules.

Switch with the command center action **Preview window skeleton A/B** (type "skeleton"). The choice is stored in `localStorage["@paseo:window-skeleton-preview"]`. The [polish inventory](polish-inventory.md) lists the remaining surfaces; none of it is implemented here.

## Captures

Real Chromium captures at DPR 1, 900px tall, from `packages/app/e2e/browser/window-skeleton-capture.spec.ts` against an isolated e2e daemon. Each image is **main `8400a809` | A | B** with the same fixture and scroll rule; reduced-transparency and focus-mode images have no main column. Project names are random per run. Images are 256-colour PNGs to keep the repository small, so soft shadows show banding the app does not have.

**Simulated:** every `mac-*` capture forces the macOS branch on Linux by installing a `darwin` desktop bridge before the app boots, and paints a blurred wallpaper under the transparent body to stand in for window vibrancy. It runs the real `getIsElectronMac()` code path, not real NSVisualEffectView vibrancy, traffic lights or SF Pro. `web-*` captures are the browser path, which Windows and Linux desktop share. 390px captures are responsive web, not native iOS/Android.

### Seam close-up (2.5×)

The sidebar/workspace boundary at 1440, main | A | B: [macOS dark (simulated)](zoom/mac-dark-1440-conversation.png), [macOS light (simulated)](zoom/mac-light-1440-conversation.png), [web dark](zoom/web-dark-1440-conversation.png), [web light](zoom/web-light-1440-conversation.png).

### Matrix

| Scene                     | Web light                                               | Web dark                                               | macOS light (simulated)                                 | macOS dark (simulated)                                 |
| ------------------------- | ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------ |
| 1440 conversation         | [compare](compare/web-light-1440-conversation.png)      | [compare](compare/web-dark-1440-conversation.png)      | [compare](compare/mac-light-1440-conversation.png)      | [compare](compare/mac-dark-1440-conversation.png)      |
| 1440 sidebar collapsed    | [compare](compare/web-light-1440-sidebar-collapsed.png) | [compare](compare/web-dark-1440-sidebar-collapsed.png) | [compare](compare/mac-light-1440-sidebar-collapsed.png) | [compare](compare/mac-dark-1440-sidebar-collapsed.png) |
| 1440 menu                 | [compare](compare/web-light-1440-menu.png)              | [compare](compare/web-dark-1440-menu.png)              | [compare](compare/mac-light-1440-menu.png)              | [compare](compare/mac-dark-1440-menu.png)              |
| 1440 dialog               | [compare](compare/web-light-1440-dialog.png)            | [compare](compare/web-dark-1440-dialog.png)            | [compare](compare/mac-light-1440-dialog.png)            | [compare](compare/mac-dark-1440-dialog.png)            |
| 1440 reduced transparency | [A, B](compare/web-light-1440-reduced-transparency.png) | [A, B](compare/web-dark-1440-reduced-transparency.png) | [A, B](compare/mac-light-1440-reduced-transparency.png) | [A, B](compare/mac-dark-1440-reduced-transparency.png) |
| 1440 focus mode           | [A, B](compare/web-light-1440-focus-mode.png)           | [A, B](compare/web-dark-1440-focus-mode.png)           | —                                                       | —                                                      |
| 390 conversation          | [compare](compare/web-light-390-conversation.png)       | [compare](compare/web-dark-390-conversation.png)       | [compare](compare/mac-light-390-conversation.png)       | [compare](compare/mac-dark-390-conversation.png)       |
| 390 menu                  | [compare](compare/web-light-390-menu.png)               | [compare](compare/web-dark-390-menu.png)               | [compare](compare/mac-light-390-menu.png)               | [compare](compare/mac-dark-390-menu.png)               |
| 390 dialog                | [compare](compare/web-light-390-dialog.png)             | [compare](compare/web-dark-390-dialog.png)             | [compare](compare/mac-light-390-dialog.png)             | [compare](compare/mac-dark-390-dialog.png)             |

The 390px columns differ only in content (random project name, timestamps): compact layouts keep the full-screen workspace in both candidates. The bottom-left lightning badge is the Expo dev LogBox toast, present only in Metro dev bundles ([inventory item 7](polish-inventory.md#7-bottom-left-floating-badge)).

Reproduce (set `E2E_SKELETON_VARIANTS=a` or `b` for one candidate):

```bash
cd packages/app
E2E_SKELETON_CAPTURE=1 E2E_SKELETON_OUT=/tmp/skeleton E2E_GPU_COMPOSITING=1 \
  npx playwright test --project=browser e2e/browser/window-skeleton-capture.spec.ts
```

## Regression

`packages/app/e2e/browser/materials.spec.ts`:

- `window skeleton floats the workspace panel` (forced macOS and web): A at 1440 has an 8px gap between sidebar and panel, 8px to the top, right and bottom edges, a 12px radius, a 1px panel border and no sidebar right border. Web also checks that focus mode removes the panel and exiting restores it. At 390 the panel slot is absent.
- `window skeleton preview B floats the sidebar`: B at 1440 insets the sidebar 8px from the top, left and bottom, with a 16px radius and a full 1px border, and the workspace panel reaches the right edge with no radius.

## Verification gaps

- Real macOS: vibrancy strength, traffic-light alignment once the collapsed-sidebar header moves down by the inset (A) or sits on the sidebar card (B), and native full screen.
- Windows/Linux desktop: the custom window controls in the top-right corner now sit over the panel's top inset (A) or beside the trailing capsule (B); not captured.
- B: content does not scroll under the sidebar; the sidebar keeps its layout column and the ground shows through its glass.
- Focus mode is captured and asserted on the web path only, not under the forced macOS branch.
