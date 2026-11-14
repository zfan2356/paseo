# Desktop material study — Contract v2

Choose a visible material direction before production integration. This Draft PR keeps the renderer opt-in and the sidebar row structure owned by WORK-396. The recommended starting point is **balanced / 中等**: the wallpaper and moving illustration remain visible through the tint, while pronounced / 明显 deliberately exposes more color.

**Every screenshot is the real App in Chromium. macOS vibrancy is 模拟 (simulated): an authored coastal wallpaper is blurred behind the window. The CSS backdrop blur over the transcript is real.** The 390px captures are responsive Web. Linux uses **DejaVu Sans**, not SF Pro.

## Compare the strengths

All four columns use the same content, viewport and reading position. The artwork contains a bright sun, warm sky, teal water and dark foreground so material strength is visible. Geometry assertions require an image to overlap both the header and composer by more than 15px in the pronounced desktop capture.

| Theme       | Original                                    | Restrained / 克制                              | Balanced / 中等 — recommended                | Pronounced / 明显                              |
| ----------- | ------------------------------------------- | ---------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| Light, 1440 | [before](light-1440-conversation-solid.png) | [12px](light-1440-conversation-restrained.png) | [20px](light-1440-conversation-balanced.png) | [28px](light-1440-conversation-pronounced.png) |
| Dark, 1440  | [before](dark-1440-conversation-solid.png)  | [12px](dark-1440-conversation-restrained.png)  | [20px](dark-1440-conversation-balanced.png)  | [28px](dark-1440-conversation-pronounced.png)  |

![Pronounced light — vibrancy 模拟](light-1440-conversation-pronounced.png)

![Pronounced dark — vibrancy 模拟](dark-1440-conversation-pronounced.png)

## Detail changes

The crops are taken from the same rendered surfaces as the full screenshots. They are not redrawn mockups. Each change is active only in the material preview.

| Detail            | Before                                                       | After                                                                                                | Comparison                                                                                                                           |
| ----------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Surface hierarchy | White/zinc slabs and stacked hard rules                      | Quiet green-neutral content plane; tint separates the floating chrome; chrome dividers removed       | [chrome before](detail-light-chrome-solid.png) → [after](detail-light-chrome-balanced.png)                                           |
| Secondary strip   | Full-width “Linked PRs/MRs · 0” row displaces the transcript | 28px contextual pill at the top right; the action still expands its panel                            | [before](detail-light-secondary-solid.png) → [after](detail-light-secondary-balanced.png)                                            |
| Composer          | In-flow box, smaller padding                                 | Floating surface, 24px corners, 20px inset, shared shadow; measured bottom clearance                 | [before](detail-light-composer-solid.png) → [after](detail-light-composer-balanced.png)                                              |
| Menus/popovers    | Tight 8px container corners                                  | 16px corners, 6px outer inset, common glass tint/elevation                                           | [before](detail-light-menu-solid.png) → [after](detail-light-menu-balanced.png)                                                      |
| Dialogs           | 520px card, stronger header rule                             | 560px cap, 24px corners, softened header edge and deeper elevation                                   | [before](detail-light-dialog-solid.png) → [after](detail-light-dialog-balanced.png)                                                  |
| Banner card       | Edge-to-edge strip and high-emphasis dark CTA                | Inset 16px-radius card, 12px outer spacing, 16px inset and tonal action                              | [before](detail-light-banner-solid.png) → [after](detail-light-banner-balanced.png)                                                  |
| Icon rhythm       | Independent sizes across chrome/menu/composer                | Chrome/menu/banner glyphs 16px; composer actions 20px; 1.5px stroke                                  | [menu before](detail-light-menu-solid.png) → [after](detail-light-menu-balanced.png), [composer](detail-light-composer-balanced.png) |
| Font stack        | General system-ui stack followed by vendor fallbacks         | Preview chrome starts with `-apple-system, BlinkMacSystemFont`; then Segoe UI, Noto Sans, sans-serif | [chrome before](detail-light-chrome-solid.png) → [after](detail-light-chrome-balanced.png)                                           |

The font row records a priority change, not a claim to show SF Pro on Linux. Both system fallback routes can resolve to DejaVu Sans here. Markdown/code keep their own typography; the preview does not replace code fonts with the UI stack.

## Recommended matrix and fallback

| Theme / width | Conversation                                                                                | Menu                                                                        | Dialog                                                                          | Reduced transparency                          |
| ------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| Light 1440    | [before](light-1440-conversation-solid.png) → [after](light-1440-conversation-balanced.png) | [before](light-1440-menu-solid.png) → [after](light-1440-menu-balanced.png) | [before](light-1440-dialog-solid.png) → [after](light-1440-dialog-balanced.png) | [opaque](light-1440-reduced-transparency.png) |
| Dark 1440     | [before](dark-1440-conversation-solid.png) → [after](dark-1440-conversation-balanced.png)   | [before](dark-1440-menu-solid.png) → [after](dark-1440-menu-balanced.png)   | [before](dark-1440-dialog-solid.png) → [after](dark-1440-dialog-balanced.png)   | [opaque](dark-1440-reduced-transparency.png)  |
| Light 390     | [before](light-390-conversation-solid.png) → [after](light-390-conversation-balanced.png)   | [before](light-390-menu-solid.png) → [after](light-390-menu-balanced.png)   | [before](light-390-dialog-solid.png) → [after](light-390-dialog-balanced.png)   | [opaque](light-390-reduced-transparency.png)  |
| Dark 390      | [before](dark-390-conversation-solid.png) → [after](dark-390-conversation-balanced.png)     | [before](dark-390-menu-solid.png) → [after](dark-390-menu-balanced.png)     | [before](dark-390-dialog-solid.png) → [after](dark-390-dialog-balanced.png)     | [opaque](dark-390-reduced-transparency.png)   |

The “before” column also shows the default non-macOS opaque fallback. Non-Mac desktop never enables native vibrancy. Explicit Web preview can still show CSS glass. Reduced transparency removes blur and transparent window layers while retaining the preview's layout and geometry. The four fallback images capture a settled open dialog, not a closing animation.

## Tokens and contrast

`MATERIAL_PREVIEW` in `packages/app/src/styles/theme.ts` owns the values. `material-preview.web.tsx` generates the opt-in CSS and provides the [strength selector](switch-light.png). No row has its own backdrop filter.

| Strength   | Floating opacity | Sidebar opacity | Blur | Saturation |
| ---------- | ---------------: | --------------: | ---: | ---------: |
| Restrained |              86% |             82% | 12px |       1.12 |
| Balanced   |              76% |             74% | 20px |       1.30 |
| Pronounced |              64% |             64% | 28px |       1.50 |

| Shared token                               | Value                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| Glass base, light / dark                   | #ffffff / #121a16                                                                     |
| Content plane, light / dark                | #f7f9f6 / #171e1b                                                                     |
| Secondary text, light / dark               | #303a33 / #f0f4f1                                                                     |
| Success / danger / warning / merged, light | #16331f / #571d18 / #3f2b11 / #3b225b                                                 |
| Success / danger / warning / merged, dark  | #e6ffef / #fff1ee / #fff5e5 / #faf3ff                                                 |
| Radius: composer / menu / dialog / banner  | 24 / 16 / 24 / 16px                                                                   |
| Inset: composer / menu / banner            | 20 / 6 / 16px; banner outer spacing 12px                                              |
| Icons: chrome / primary actions            | 16 / 20px, 1.5px stroke                                                               |
| Border light / dark                        | white 65% / white 18%                                                                 |
| Small elevation light / dark               | 0 12px 36px black-green 14% / black 38%, plus inner highlight                         |
| Dialog elevation light / dark              | 0 32px 96px black-green 24% / black 55%                                               |
| Motion                                     | 160ms cubic-bezier(0.2,0,0,1), preview timing applies only when reduced motion is off |

The same tint serves composer, menus, popovers, dialogs and compact Web sheets. Headers use it without an outer shadow. Banner cards use a 74% protective base. The content plane remains opaque. Hover, pressed and selected fills retain the existing semantic interaction tokens; the sidebar rows themselves are unchanged.

[Contrast source](contrast.mjs) reads the current literal tokens from theme.ts. [Raw results](contrast.json) composite each opacity over worst-case black in light mode and white in dark mode, then apply the WCAG sRGB relative-luminance formula. The calculation covers body, secondary and four semantic text colors on both floating and sidebar glass. Lowest ratios across those roles/surfaces:

| Strength   |  Light |   Dark |
| ---------- | -----: | -----: |
| Restrained | 7.74:1 | 9.10:1 |
| Balanced   | 6.26:1 | 6.81:1 |
| Pronounced | 4.69:1 | 4.79:1 |

## Native code evidence

Contract v2 replaces native screenshots with code evidence. The native `material-preview.tsx` returns null; all CSS and preview controls live in `.web.tsx`. The base `sidebar-material-color.ts` returns each supplied color unchanged, including the new status-color helper. [The executable passthrough check](native-code.txt) verifies this. `composer/dock/index.native.tsx` and `composer/dock/internal/background.native.tsx` are identical to main `b60da86b`.

Shared components receive stable `dataSet` markers only. Position, blur, spacing and font changes are CSS rules and do not enter native styles. The added chrome measurement's DOM write is guarded by `isWeb`; the existing width measurement is unchanged. No native blur package or dependency was added. This is code evidence, not a claim that a native device test ran.

## Reproduce

Build dependencies with `npm ci` and `npm run build:server`. In renderer DevTools set `localStorage.setItem("paseo:material-preview", "balanced")` and reload. Use the four-button selector to switch between original and the three strengths. Remove the key and reload to disable the study.

On Mac, launch with `PASEO_MATERIAL_PREVIEW=1 npm run dev:desktop` and enable the renderer key. The main window uses sidebar vibrancy, follows activation, and restores the latest opaque chrome color on `nativeTheme.prefersReducedTransparency` changes.

```sh
E2E_GPU_COMPOSITING=1 PASEO_MATERIAL_QA=1 E2E_WORKERS=1 npm run test:e2e --workspace=@getpaseo/app -- material-preview.spec.ts
node docs/qa-evidence/material-preview/contrast.mjs
```

Use installed Chromium or set `E2E_CHROMIUM_EXECUTABLE_PATH`. This run uses Chromium 140 / headless-shell 1187 with ANGLE/SwiftShader. GPU compositing is asserted enabled; default headless Linux can report the CSS property without actually painting blur. Video and trace recording are disabled for the measurement. Finish clean builds before starting Metro.

The independent evidence spec serves the authored [wallpaper](wallpaper.svg) to the real Markdown renderer. The sidebar background uses a 32px blurred copy to simulate native wallpaper sampling. The transcript images stay sharp until they scroll under a surface. Tests own and stop an isolated daemon; they never restart port 6767.

## Scroll measurement

[Frames](frames.json), [paint properties](paint.json) and [environment](environment.json) are the raw evidence. Each strength has three paired blur-off/on trials, alternating order. Only backdrop-filter changes within a pair; tint, layout, shadows and wallpaper stay constant. The workload is 18 Markdown sections with illustrations, paragraphs and tables at 1440×1000, DPR 1.

Each trial uses real wheel input to leave follow mode, resets to 30% of scroll height, then advances 12px per animation frame and reverses after 90 frames. It records 180 frames and discards the first 30 intervals. Samples include actual scroll positions and the effective filter; assertions require more than 60 distinct positions and the expected filter state. Per strength, each mode retains 450 intervals.

This measures requestAnimationFrame cadence and synchronous scroll writes, not GPU execution time or compositor presentation. It uses a shared Linux VM and software GPU. Do not compare directly with v1's text-only workload, and do not treat a steady cadence as proof that blur has no cost on Mac.

| Strength   | Blur | Intervals |   Median |      P95 |  Maximum |
| ---------- | ---- | --------: | -------: | -------: | -------: |
| restrained | off  |       450 | 16.70 ms | 16.80 ms | 16.80 ms |
| restrained | on   |       450 | 16.70 ms | 16.80 ms | 16.80 ms |
| balanced   | off  |       450 | 16.70 ms | 16.70 ms | 16.80 ms |
| balanced   | on   |       450 | 16.70 ms | 16.80 ms | 16.80 ms |
| pronounced | off  |       450 | 16.70 ms | 16.80 ms | 16.80 ms |
| pronounced | on   |       450 | 16.70 ms | 16.70 ms | 16.80 ms |

All trials passed the scroll-position and effective-filter assertions. The current workload stayed near the 60Hz requestAnimationFrame period; the scheduler quantization cannot establish a zero GPU cost. The recommendation is visual, pending a Mac presentation-time measurement.

## Verification and Mac follow-up

The v1 desktop main/window configuration is unchanged. Its full Linux unpacked desktop build remains applicable; this revision rebuilds main and runs the full workspace typecheck/lint plus the new evidence spec. No independent review is required by v2. Self-review: the opt-in CSS layer is suitable for this comparison; production integration remains a later phase after approval and WORK-396.

| Check                                        | Result                                                                             | Evidence                                              |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Independent visual/scroll spec               | Passed; 32 full captures, 24 detail crops, two selectors; 2,700 retained intervals | [browser](browser.txt), [frames](frames.json)         |
| Full workspace typecheck                     | Passed for v2                                                                      | [typecheck](typecheck.txt)                            |
| Full workspace lint                          | Passed, no warnings                                                                | [lint](lint.txt)                                      |
| Desktop main build                           | Passed for v2                                                                      | [main build](build-main.txt)                          |
| Native palette / path check                  | Passed; code evidence under v2                                                     | [native](native-code.txt)                             |
| Full Linux desktop package / 14 window tests | Reused from v1; desktop/window code unchanged                                      | [build](build-desktop.txt), [tests](window-tests.txt) |
| Native Mac runtime                           | Not run; confirmation checklist below                                              | —                                                     |

On Mac, verify real wallpaper sampling, active/inactive vibrancy, live Reduce Transparency propagation, Spaces/fullscreen, native titlebar dragging, Retina hairlines, SF Pro fallback and GPU frame timings. Those runtime claims cannot be checked on Linux. No merge, deployment or Ready transition is part of this delivery.
