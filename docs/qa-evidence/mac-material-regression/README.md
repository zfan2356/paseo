# Mac material regression: composer pills and tab close scrim

Linux Chromium, 1200×900, `window.paseoDesktop.platform = "darwin"` so `getIsElectronMac()` takes the transparent-window branch, wallpaper behind the renderer. Dark theme unless named. "Before" is `main` 02c20c4e; "after" is this branch.

## Composer pills hidden behind the composer

`[data-material="dock-composer"]` is `position: absolute; bottom: 0`, so the transcript area now runs under the composer. `ComposerTrackBar` (`packages/app/src/composer/tracks.tsx`) anchors at `bottom: 0` of that area, so the pill row (diff stat, plugin composer pills such as Magpie, subagents, tasks) lands behind the composer and only its corner shows below the composer's bottom-left edge. The transcript tail and scroll controls already lift by `--paseo-composer-clearance`; the pill track did not. The rule is not Mac-specific: plain web shows the same overlap (`composer pills stay above the floating composer (web)` fails on `main` with the same −138px).

Fix: tag the bar `composer-tracks` and lift it by the same clearance as `scroll-controls`.

| Scene                                 | Before                            | After                           |
| ------------------------------------- | --------------------------------- | ------------------------------- |
| Conversation, scroll-to-bottom button | [before](before-conversation.png) | [after](after-conversation.png) |
| Image attachment                      | [before](before-attachment.png)   | [after](after-attachment.png)   |
| Dialog                                | [before](before-dialog.png)       | [after](after-dialog.png)       |
| Attachment menu                       | —                                 | [after](after-menu.png)         |
| Plain web (not Mac)                   | —                                 | [after](after-web-pills.png)    |

## Small block next to the tab close button on hover

The hovered tab shows `TrailingActionScrim`, an SVG gradient sized `width="100%" height="100%"` that fades the title into the close button. `[data-material="header"] svg { width: 16px; height: 16px }` also matched it, so the 48×28 scrim shrank to a 16×16 square of solid chip color over the end of the title. It is not a scrollbar and not related to the `chrome div` background reset.

Fix: the icon sizing rules for header, menu, banner and composer match only fixed-size SVGs (`svg:not([width$="%"])`).

| Theme | Before                               | After                              |
| ----- | ------------------------------------ | ---------------------------------- |
| Light | [before](before-tab-hover-light.png) | [after](after-tab-hover-light.png) |
| Dark  | [before](before-tab-hover-dark.png)  | [after](after-tab-hover-dark.png)  |

## Regression tests

`packages/app/e2e/browser/materials.spec.ts`:

- `composer pills stay above the floating composer (darwin|web)` — fails on `main` (pill bottom 138px below composer top), passes after.
- `header icon sizing leaves the tab close scrim at full width` — fails on `main` (scrim 16×16 vs 48×28 overlay), passes after.

## Limits

No macOS vibrancy, Retina or real plugin install; the diff stat pill stands in for plugin pills because both render in the same `ComposerTrackBar`.
