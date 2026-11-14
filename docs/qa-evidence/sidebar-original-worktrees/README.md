# Original sidebar and worktree grouping

WORK-416, contract v1. Input main: `17327eec7376632b47d63d49a06117d678de42cc`.
Original sidebar baseline: `7eb1d2cb1c15648e683e946a4c079cfbf9017236`, immediately
before WORK-372's `6ec5e2581` session navigation change.

The restored sidebar uses `SidebarWorkspaceList` and its original row styles,
icons, status, menus, archive, workspace pins and add/import actions. Relative to
the baseline, that list only contains the existing callback that closes resource
sheets before navigation. The grouping controls replace the Workspaces heading.
The retired session-card renderer and its collection, menu, projection and
settings have been removed. Stored session metadata remains intact; Explorer's
directory context and operations remain independent of sidebar grouping.

## Fixed comparison

All six images come from one browser test and one isolated daemon, with exactly
the same four project/workspace/agent identities in [fixture.json](fixture.json).
The test first renders the baseline's `left-sidebar.tsx` and `sidebar-model.tsx`,
then restores the current modules and captures both grouping modes. It asserts
that all four fixture projects remain present in every view. It does not rebuild
the fixture between views.

The main checkout uses branch `development`; its two linked worktrees use `theme`
and `main`. A pinned notes directory lives outside every Git checkout, verified
with Git itself. Images show idle and running states and contain synthetic content.
The user's private screenshot remains only in local task evidence.

| View         | Desktop, 1440×1000                 | Narrow browser, 390×844           |
| ------------ | ---------------------------------- | --------------------------------- |
| Original     | [Original](original-desktop.png)   | [Original](original-narrow.png)   |
| By directory | [Directory](directory-desktop.png) | [Directory](directory-narrow.png) |
| By project   | [Project](project-desktop.png)     | [Project](project-narrow.png)     |

Directory view retains the original sections. Project view moves the linked
worktree rows into the Git main checkout's section and applies the existing sort
to the combined rows. Row IDs and operation targets keep their original workspace
and host. When the main checkout has no project registration, the group label uses
its Git path and project-level actions retain the first actual registration.
No synthetic project ID is created.

To reproduce, copy [capture.ts.txt](capture.ts.txt) and
[capture.config.ts.txt](capture.config.ts.txt) into `<checkout>/.dev/work-416/` as
`capture.spec.ts` and `playwright.config.ts`. Save the current left-sidebar and
sidebar-model there as `final-left-sidebar.tsx` and `final-sidebar-model.tsx`.
Temporarily restore the two baseline modules, then run:

```bash
CAPTURE_COMPARE=1 npm run test:e2e --workspace=@getpaseo/app -- --config ../../.dev/work-416/playwright.config.ts
```

The harness restores the current modules between the original and directory
captures. Restore them on command failure as well. The config names the installed
Chromium on this machine. Narrow captures wait for the sidebar to stop sliding.
The existing setup-scripts callout is independent of the view and can appear after
its asynchronous config read.

## Verification

Tests use Linux Chromium 140.0.7339.16, real Metro and isolated daemons. The
lockfile's newer browser download did not finish; its process was stopped and the
already installed browser was used through a local test config. Packaged Electron
on Linux/macOS/Windows, iOS and Android are not exercised.

Terminal escape sequences and trailing whitespace are removed from saved outputs.

- [Projection and workspace view model](sort-tests.txt): 53 pass, including
  host/Git identity boundaries and combined created/last-prompt/manual order.
- [Directory/context model](model-tests.txt): 10 pass.
- [Full browser regression](browser-regression.txt): 1 pass. Grouping reads checkout
  status and sends no `checkout_refresh_request`. Row size, URL, cwd, saved pins
  and archive fields survive switching; actual pin, Files, resource navigation
  and archive also pass.
- [Combined-row ordering](sort-browser.txt): 1 pass. A real drag across main and
  linked worktree rows survives grouping changes and reload; Created and Last
  prompt sort the combined section.
- [Retained workspace/resource cases](model-b-first-two.txt): the first two cases
  pass. The following status case exposed an ambiguous test menu locator after
  both sidebar and resource sheet began using the same component.
- [Remaining resource/directory cases](model-b-remaining.txt): 7 pass after scoping
  that locator. Together these cover all 9 retained cases, including 390px binding,
  expired non-Git targets, nested Git changes, independent terminals and the
  minimum Explorer width. Retired session-card cases were replaced by workspace
  assertions and the regressions above.
- [One-daemon comparison](capture-comparison.txt): 1 pass for all six screenshots.
- [Typecheck](typecheck.txt), [lint](lint.txt), formatter and commit checks pass.
- [Server build](build-server.txt) and [production app export](build-app-final.txt):
  exit 0. Server code is unchanged by this fix.

GitHub Actions is disabled under the task's known exemption; it is not a passing
CI result. Multica PR-card integration is not configured, also a known exception.
No merge, deployment or production daemon restart is part of this task. The user
updates the packaged desktop client separately.
