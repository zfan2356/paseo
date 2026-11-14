# Composer toolbar and session status

The execution directory uses the existing composer toolbar: folder and a bounded short name on wide panes, folder alone on compact panes. Click reveals the full read-only path; desktop hover and the accessible label also name the full path. Session titles have an independent status dot using the existing status colors and `sessionStatus` semantics, including open turns, pending permissions, unread errors and background work.

## Browser evidence

Chromium 140 on Linux, 1200×1000 and 390×1000. The existing Playwright fixture starts Metro and a real isolated daemon with the deterministic provider. All four sessions share one directory; running and approval sessions are pinned, failed and idle sessions are ordinary. The test changes a running session to Ready to review, retries the failed session and moves the running retry into Pinned. Other sessions retain their own states. SVG assertions check a 20px folder in the compact window and 16px on the wide pointer window, with the same stroke color as the adjacent model control. The shared layout Provider uses window control sizing independently of pane label density.

| Surface                                   | Wide                                 | Compact                            |
| ----------------------------------------- | ------------------------------------ | ---------------------------------- |
| Inline directory, model and send controls | [1200px](toolbar-1200.png)           | [390px](toolbar-390.png)           |
| Full execution path                       | [1200px](directory-details-1200.png) | [390px](directory-details-390.png) |
| Running, approval, failure and idle       | [1200px](session-states-1200.png)    | [390px](session-states-390.png)    |

[Desktop hover](directory-hover-1200.png) and [live state changes](session-states-transition-390.png) cover the remaining interactions. Captures wait for the controls and full path to settle inside the viewport; the sidebar also checks six identical animation frames at `x = 0`. Screenshot contents were visually inspected.

[Card parity audit](card-parity-audit.md) compares the old row/menu/shortcuts with the session row, records the operation targets and separates missing session interactions from directory/workspace resource actions. Added implementations require the requester’s scope decision.

## Validation

Run from the repository root:

```sh
npm run test:e2e --workspace=@getpaseo/app -- sidebar-model-b.spec.ts --grep 'session toolbar stays inline'
```

The local configuration only selects the installed headless Chromium executable and disables video/trace recording; checked-in tests keep the normal runner. [Browser log](browser.txt): one focused test passed. With the original production files from `4695cf5ae` and the same test, the toolbar alignment assertion [fails](baseline.txt): the directory and attachment centers differ by 115px, above the 2px limit. Restoring the fix passes. [Typecheck](typecheck.txt) and [lint](lint.txt) passed. Workspace dependencies were built before checking types. Remote [CI dispatch](remote-ci.txt) returned HTTP 422 because Actions are disabled for this repository; the PR has no checks or runs. No full local suite was run. Native iOS/Android and packaged Electron were not exercised.

## Reload boundary

A separate reload probe found an existing pending-permission recovery problem: the row becomes Working after reloading the same workspace, while direct daemon snapshots still contain one pending permission. [Daemon snapshots](reload-daemon-snapshots.json) record the unchanged turn and permission count. The DOM trace received `aria-label="Working"` instead of `Needs input` after reload. The focused responsive test resizes one live app instance; it does not claim reload recovery.

The replica serializer drops pending permissions while directory checkpoints can resume unchanged cached agents. This is a candidate cause requiring directory/cache traces, not a completed diagnosis. This change leaves cache persistence and directory synchronization intact; follow-up ownership belongs to the requester.
