# Desktop material preview — WORK-397

This is an opt-in visual study for the macOS desktop app. The Draft PR is not a release candidate. The sidebar structure stays with WORK-396; this branch changes its color token and the window paint layers only. The layout, Paseo green accent, icons and typography remain Paseo's.

## Run the preview

Build dependencies with `npm ci` and `npm run build:server`. Start the app using the existing development commands. In renderer DevTools, run `localStorage.setItem("paseo:material-preview", "glass")`, then reload. To return to the original surfaces, remove that storage key and reload. The marker can also switch between `document.documentElement.dataset.materialPreview = "solid"` and `"glass"` without replacing the conversation.

On Mac, start the desktop development process with `PASEO_MATERIAL_PREVIEW=1 npm run dev:desktop`, then enable the renderer key above. The main window uses `sidebar` vibrancy and follows window activation. Without the environment variable it retains the existing opaque window. The IPC chrome-color update preserves a transparent window while the preview is enabled, and remembers the opaque theme color for accessibility fallback.

Run the evidence through the existing suite:

```sh
E2E_GPU_COMPOSITING=1 PASEO_MATERIAL_QA=1 E2E_WORKERS=1 npm run test:e2e --workspace=@getpaseo/app -- plan-card-markdown.spec.ts --grep 'material preview evidence'
```

Use an installed Playwright Chromium, or set `E2E_CHROMIUM_EXECUTABLE_PATH` to its executable. The local run selects Chromium headless shell 140 (cache revision 1187), disables video/trace, and runs one worker. `E2E_GPU_COMPOSITING=1` enables ANGLE/SwiftShader GPU compositing; the capture asserts it is enabled. The default Linux headless configuration reports the CSS blur property but does not paint it. The checked-in captures and timing samples use actual blur, not that configuration. Complete clean builds before starting Metro: the desktop build removes declarations and JS bundles that Metro consumes.

## Materials and tokens

`MATERIAL_PREVIEW` in `packages/app/src/styles/theme.ts` owns the study tokens. Native resolves separate modules that leave palette values and presentation unchanged. CSS is scoped to the opt-in root marker and semantic surface attributes. This CSS override layer is for comparing the direction before component integration, not a new permanent styling engine.

| Token                                  | Value                               |
| -------------------------------------- | ----------------------------------- |
| blur / saturation                      | 24 px / 1.15                        |
| opacity / sidebarOpacity               | 0.90 / 0.90                         |
| hairline                               | 1 CSS px                            |
| radius.composer / menu / dialog        | 20 / 12 / 20 px                     |
| motion.duration / easing               | 160 ms / cubic-bezier(0.2, 0, 0, 1) |
| light.foregroundMuted                  | #5c605f                             |
| dark.foregroundMuted                   | #b3b7b5                             |
| light.border / dark.border             | black 10% / white 12%               |
| light.shadow / dark.shadow             | 0 8px 32px, black 10% / 28%         |
| light.dialogShadow / dark.dialogShadow | 0 24px 80px, black 18% / 42%        |

The existing `fontSize.base=14`, `fontSize.content=15`, system UI font stack, normal/medium weight tiers and `interactionHighlight` hover/press/selected fill remain the control language. State colors remain the existing semantic status palette. There is no per-row blur.

| Surface                   | Material                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| Desktop window / sidebar  | OS vibrancy under 90% theme tint; transparent root paint layers              |
| Conversation, code, files | Opaque existing surfaces                                                     |
| Composer                  | 90% theme surface over conversation, 24px blur, hairline and small elevation |
| Top bars                  | Same tint and blur, no shadow                                                |
| Menus / combobox popovers | Same tint, hairline, 12px corners and small elevation                        |
| Dialogs                   | Same tint, 20px corners and larger elevation                                 |
| Compact Web sheets        | Same tint and blur; keep existing top corner geometry                        |
| Native iOS/Android        | Existing opaque colors, dock geometry and sheet backgrounds                  |

The composer reserves its measured height at the end of the transcript, so the last message can scroll above it. The layout event updates a CSS variable; streaming text does not trigger a document-wide observer.

## Readability

[Raw contrast calculations](contrast.json) composite the tint in sRGB over the worst possible backdrop: black for light mode and white for dark mode. Ratios use unrounded channel values and the WCAG relative-luminance formula. They apply to text directly on glass; status badges retain their own tinted backgrounds.

| Text      |   Light |    Dark |
| --------- | ------: | ------: |
| Body      | 13.84:1 | 12.43:1 |
| Secondary |  5.09:1 |  6.40:1 |
| Success   |  4.62:1 |  5.07:1 |
| Danger    |  5.08:1 |  4.64:1 |
| Warning   |  4.83:1 |  4.81:1 |
| Merged    |  5.15:1 |  4.71:1 |

The initial 72% sidebar tint failed secondary/state-text contrast on extreme wallpapers. The preview uses 90% to preserve legibility without changing the status palette.

## Screenshot matrix

All images are real Chromium renders of the App with an isolated daemon and a deterministic provider response. The 36-section transcript is identical across captures. **macOS vibrancy is 模拟 (simulated)** by a synthetic gradient wallpaper behind the transparent app paint layers. Chromium CSS backdrop blur is real; OS desktop sampling, SF Pro and native window activation are not represented. The 390px images are responsive Web, not native device captures.

| Theme / width | Conversation before → after                                                              | Menu before → after                                                      | Dialog before → after                                                        | Reduced transparency                          |
| ------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------- |
| Light 1440    | [before](light-1440-conversation-solid.png) → [after](light-1440-conversation-glass.png) | [before](light-1440-menu-solid.png) → [after](light-1440-menu-glass.png) | [before](light-1440-dialog-solid.png) → [after](light-1440-dialog-glass.png) | [opaque](light-1440-reduced-transparency.png) |
| Dark 1440     | [before](dark-1440-conversation-solid.png) → [after](dark-1440-conversation-glass.png)   | [before](dark-1440-menu-solid.png) → [after](dark-1440-menu-glass.png)   | [before](dark-1440-dialog-solid.png) → [after](dark-1440-dialog-glass.png)   | [opaque](dark-1440-reduced-transparency.png)  |
| Light 390     | [before](light-390-conversation-solid.png) → [after](light-390-conversation-glass.png)   | [before](light-390-menu-solid.png) → [after](light-390-menu-glass.png)   | [before](light-390-dialog-solid.png) → [after](light-390-dialog-glass.png)   | [opaque](light-390-reduced-transparency.png)  |
| Dark 390      | [before](dark-390-conversation-solid.png) → [after](dark-390-conversation-glass.png)     | [before](dark-390-menu-solid.png) → [after](dark-390-menu-glass.png)     | [before](dark-390-dialog-solid.png) → [after](dark-390-dialog-glass.png)     | [opaque](dark-390-reduced-transparency.png)   |

## Fallback and Mac confirmation

`prefers-reduced-transparency: reduce` removes the tint, blur and translucent sidebar immediately. Electron also listens to `nativeTheme.updated`, removes vibrancy and restores the latest opaque theme color when `prefersReducedTransparency` changes. Non-Mac desktop never enables native vibrancy; its default solid captures above are the fallback reference. Browser preview glass is explicitly opt-in. Native modules leave colors unchanged; no native blur dependency is added.

Linux cannot verify wallpaper sampling through the macOS window, live system accessibility propagation to Chromium, active/inactive vibrancy, Spaces/fullscreen, native titlebar dragging, Retina hairlines or SF Pro rendering. Confirm these on Mac before approving implementation. No iOS/Android runtime is available in this workspace; native screenshots and device verification remain a delivery gap, not evidence supplied by the 390px Web captures.

Native appearance reference: the existing [iPhone chat capture](../../../assets/store-screenshots/raw/iphone/chat.png) on main shows the opaque fallback. It is a pre-existing native capture, not a device run of this branch; it does not close the missing current native-evidence item.

## Scroll measurement

[Raw frame samples](frames.json), [rendered paint properties](paint.json), and [environment](environment.json) accompany the images. The workload is one completed assistant response with 36 Markdown sections, paragraphs, inline code and code blocks, rendered by the real transcript at 1440×1000, DPR 1. Each of three paired trials runs 180 animation frames, discards the first 30 intervals and retains 150. The scroll offset changes by 12px per frame, reversing after 90 frames. Each run starts at 30% of scroll height. Alternating off/on order limits warmup bias.

Both cases retain the glass tint, geometry, shadows and DOM. The off case overrides only backdrop-filter to none. Frame intervals measure delivered requestAnimationFrame cadence, including browser scheduling/compositing; the separate writes array times synchronous scrollTop assignments. Neither is a pure GPU execution-time measurement. The VM uses AMD EPYC and SwiftShader software GPU compositing; this is not a Mac or a hardware GPU benchmark. The JSON records scroll dimensions and node count per trial. No typecheck/build was run during sampling.

The response contains 15,433 characters; the captured performance page contains 2088 DOM nodes. The final samples show a substantial software-compositing cost:

| Mode          | Samples |   Median |      P95 |  Maximum |
| ------------- | ------: | -------: | -------: | -------: |
| Blur disabled |     450 | 16.70 ms | 33.40 ms | 33.50 ms |
| 24px blur     |     450 | 33.20 ms | 49.90 ms | 83.40 ms |

These measurements do not establish 60fps on macOS. Check a real Mac GPU with the same load before implementation approval; lower the blur budget if its measured frame cost is unacceptable.

## Validation and review boundary

The preview uses the existing npm workspace build and test commands. Browser runs own an isolated daemon/home and shut it down afterward; the main daemon was not restarted. The final matrix covers 24 before/after images plus four reduced-transparency dialog images. Desktop configuration also completed a Linux unpacked desktop build (including Electron web export and main-process compilation).

Self-review only, per Contract v1: **Taste: Good for the preview scope.** One token set owns material strength, the native module boundary keeps fallback behavior, and the window owns its accessibility listener and latest opaque color. The CSS override layer and manual opt-in serve the visual comparison; production integration remains a separate phase after approval and WORK-396. No independent review, merge, deployment or Ready transition is included.

| Check                                    | Result                                          | Evidence                         |
| ---------------------------------------- | ----------------------------------------------- | -------------------------------- |
| Real App screenshot and scroll capture   | Passed; 28 images, 900 retained frame intervals | [browser log](browser.txt)       |
| Window manager regression file           | Passed; 14 tests                                | [tests](window-tests.txt)        |
| Full workspace typecheck                 | Passed                                          | [typecheck](typecheck.txt)       |
| Full workspace lint                      | Passed; no warnings                             | [lint](lint.txt)                 |
| Desktop build / Linux unpacked package   | Passed                                          | [build](build-desktop.txt)       |
| Final desktop main compilation           | Passed                                          | [main](build-main.txt)           |
| macOS compositor / accessibility runtime | Not run on Linux; Mac confirmation list above   | —                                |
| Current native iOS/Android screenshots   | Blocked: no device runtime in this workspace    | Existing baseline reference only |

Contract v1 items 0 (preview matrix), 2 (Chromium measurements), and 3 (desktop configuration/build with Mac limitations) have evidence. Item 1 has token and contrast specifications and Web fallback captures, but lacks current native device screenshots. Root must provide a native capture environment or revise that evidence requirement; this branch does not waive it.
