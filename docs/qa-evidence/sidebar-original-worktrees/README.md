# Original sidebar and worktree grouping

WORK-416, contract v1. Input main: `17327eec7376632b47d63d49a06117d678de42cc`.
Original sidebar baseline: `7eb1d2cb1c15648e683e946a4c079cfbf9017236`, immediately
before WORK-372's `6ec5e2581` session navigation change.

The baseline captures render that revision's `left-sidebar.tsx` and
`sidebar/sidebar-model.tsx` against the same isolated daemon and fixed directories
as the updated captures. The retained `SidebarWorkspaceList` differs from that
baseline only by its existing callback that closes resource sheets before navigation.
Shared row content has since been extracted into `SidebarCardContent`; the workspace
call does not use its session-only press targets or sizing. This is a component
restoration, with the original list, row styles, icons, status, menus, archive,
workspace pins and add/import actions. The grouping controls replace the old
Workspaces heading and remain above the pinned section.

The fixture uses a main checkout on branch `development`, two linked worktrees
(one on a branch named `main`), and a pinned non-Git notes directory. It includes
an idle row and a running mock agent. All images contain synthetic content.
The user's private screenshot is retained only in the task's local evidence directory.
Copy the [capture harness](capture.ts.txt) and [config](capture.config.ts.txt) into
`<checkout>/.dev/work-416/` as `capture.spec.ts` and `playwright.config.ts`. Use
`npm run test:e2e --workspace=@getpaseo/app -- --config ../../.dev/work-416/playwright.config.ts`.
`CAPTURE_BASELINE=1` captures the original after temporarily restoring the two baseline
modules; restore the final modules before capturing both updated views. The browser
path in the local config names the installed Chromium on this machine.

| View         | Desktop, 1440×1000                 | Narrow browser, 390×844           |
| ------------ | ---------------------------------- | --------------------------------- |
| Original     | [Original](original-desktop.png)   | [Original](original-narrow.png)   |
| By directory | [Directory](directory-desktop.png) | [Directory](directory-narrow.png) |
| By project   | [Project](project-desktop.png)     | [Project](project-narrow.png)     |

The original and directory views retain separate directory sections. Project view
moves only the two linked worktree rows under the main checkout's section. Row
operation targets keep their actual workspace and host identity. Narrow captures
wait for the navigation overlay to finish sliding in. The existing setup-scripts
callout can appear after its asynchronous project-config read; it is independent
of the sidebar view.

## Verification

Terminal escape sequences and trailing whitespace are removed from the saved outputs.

Linux browser tests use the installed headless Chromium 140.0.7339.16 with a real,
isolated daemon and Metro. The lockfile's newer browser download did not finish;
its process was stopped after verifying this already installed browser. It is an
explicit local test configuration, with no application runtime override.

- [Projection tests](projection-tests.txt): 9 pass, including linked worktrees,
  non-Git directories, same names, separate hosts, repository subdirectories,
  missing Git facts, a missing main project, and main facts still loading.
- [Workspace view model](workspace-view-model-tests.txt): 42 pass.
- [Original capture](capture-original.txt) and [updated capture](capture-updated.txt):
  each passes against the fixed directory fixture.
- [Server build](build-server.txt): exit 0.
- [App build](build-app-final.txt): `CI=1 EXPO_NO_TELEMETRY=1 npm run build --workspace=@getpaseo/app`,
  exit 0, including production Expo web export. An earlier export produced output
  but its process ended with signal 143; only the completed run is counted.

- [Typecheck](typecheck.txt) and [lint](lint.txt): exit 0.
- [Browser regression](browser-regression.txt): 1 pass; the complete navigation, pin, resource and archive flow.

The browser regression in `packages/app/e2e/browser/sidebar-workspace.spec.ts`
compares row width/height, URL, saved selection, directory, pins and archive fields
across both grouping buttons. The resource list no longer mounts the unused session collection. Session surfaces
acquire it where consumed, so sidebar view changes cannot trigger its pin-order
migration. Runtime Git/forge metadata is allowed to hydrate;
it is excluded from the persisted-field comparison. Its final log also covers
pinning, Files directory selection, resource-sheet navigation and archiving.

GitHub Actions is disabled under the task's known exemption; it is not a passing
CI result. GitHub integration is not configured for Multica PR-card binding, also
a known task exception. No merge, deployment or production daemon restart is part
of this task. Web desktop and narrow layouts are exercised; packaged Electron on
Linux/macOS/Windows, iOS and Android are not exercised. The user updates the
packaged desktop client separately.
