# Session card actions

WORK-389 restores session actions at the card. Kebab and web right-click share Rename session, Pin/Unpin session, Labels, Mark as read and Archive session. Fine-pointer hover reveals the shared archive glyph beside the kebab. Touch uses the kebab and compact menu sheet. Actions name the host and agent; sharing a directory does not share the operation target.

Creating a label writes a host catalog definition, then assigns it through SessionContext. Existing definitions keep their colors on retry. A conflicting color fails without changing the catalog. If assignment fails after creation, the form retains its draft and explains that the definition already exists. Old hosts can assign existing labels; creation asks for a host update.

## Browser evidence

The existing Playwright fixture starts Metro and a real isolated daemon with deterministic agents. Fault cases delay or reject specific requests at the browser WebSocket boundary; successful operations and out-of-band updates use that daemon. These cases exercise the UI's failure response, not provider authentication or production service availability.

Chromium 140 on Linux. Pointer layouts use 1200×1000 and 390×1000; a separate 390×1000 context sets `hasTouch: true` and `isMobile: true`, asserts fine-pointer=false and uses taps. Screenshots wait for stable geometry and menu ancestor opacity; a disabled row keeps its designed opacity. Images were visually inspected.

| Surface                                   | Evidence                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Wide right-click menu                     | [original card](baseline-menu-1200.png), [restored controls](session-context-menu-1200.png)             |
| Compact menu                              | [390px](session-menu-390.png)                                                                           |
| Touch menu and label creation             | [menu](session-touch-menu-390.png), [create](session-touch-label-create-390.png)                        |
| Archive refusal keeps the current session | [1200px](session-archive-failure-1200.png)                                                              |
| Archived history after an RPC error       | [1200px](session-authoritative-history-1200.png)                                                        |
| Viewer and disconnected host              | [read only](session-readonly-1200.png), [offline](session-offline-1200.png)                             |
| Basic actions without session context     | [unsupported host](session-context-unsupported-1200.png), [failed read](session-context-error-1200.png) |

Viewer permissions and the old label-creation capability are negotiated as handshake fixtures on reconnect. These verify UI gating, not daemon authorization. The [pending-permission reload boundary](../session-toolbar-state/README.md#reload-boundary) remains separate. iOS, Android and packaged Electron are not exercised; desktop users need to update the app to receive the renderer changes.

## Validation

The focused browser matrix covers:

1. Same-directory sessions in Pinned and ordinary groups; direct hover, kebab and right-click; rename, pin/unpin, catalog creation/color and session assignment; protected approval attention; current archive with sibling/workspace isolation.
2. Pending archive keeps the current tab and prevents a duplicate request, then focuses the nearest tab; closing the final session exposes the existing New tab launcher.
3. Rename, pin, read and label failures retain actionable errors/drafts; creation followed by failed assignment retries the existing definition. Old hosts can assign labels, viewer writes are disabled, and disconnected rows stay visible with disabled writes.
4. Real touch context: no hover target, visible tappable kebab, pin and label creation/assignment.
5. A noncurrent session moves from Ready to review to Done, then archives without taking focus. A server archive update arriving before the original request's failure does not resurrect its session or tab; History retains the archived record.
6. A workspace descriptor update while a label assignment is pending keeps the duplicate-submit guard and later failure visible; retry succeeds.
7. A host without sessionContext and a host whose initial context observation fails still allow rename, read and hover archive; pin/labels stay disabled. Only actual context loading gates the basic menu.

Run only these cases from the repository root:

```sh
npm run test:e2e --workspace=@getpaseo/app -- sidebar-model-b.spec.ts workspace-labels.spec.ts --grep 'session card|same-target descriptor refresh'
```

The local runner only selects the installed headless Chromium executable and disables video/trace; checked-in runner settings are unchanged. Runtime source: `983e03355db2ccb7d0cf79cf0b008648d2d60374`, against main `030f54b7c7c2ef4c4bca7a427a3fa6dfd727e7af`. The six-case matrix was collected for `44b9506e`; the later context-capability fix has two targeted cases. The Reviewer requested those focused cases without repeating the unaffected matrix. [PR #16](https://github.com/zfan2356/paseo/pull/16) carries the exact delivery revision and evidence.

| Check                                                | Result                                                                          | Log                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Browser matrix                                       | 6 passed                                                                        | [browser](browser.txt)                                                           |
| Context capability/error boundaries                  | 2 passed; candidate 9ac930caf fails the unsupported-host case                   | [before](context-unavailable-before.txt), [after](context-unavailable-after.txt) |
| Context fix repository checks                        | Full typecheck/lint/format passed                                               | [checks](context-commit-checks.txt)                                              |
| Offline screenshot recapture                         | 1 passed; same behavior, menu animation settled                                 | [capture](offline-capture.txt)                                                   |
| Catalog service file                                 | 26 passed                                                                       | [unit](labels-unit.txt)                                                          |
| Server and workspace dependency build                | Passed                                                                          | [build](build-server.txt)                                                        |
| Full workspace typecheck, staged lint and formatting | Passed                                                                          | [commit checks](commit-checks.txt)                                               |
| GitHub Actions                                       | Not run; known disabled-repository exemption. No runs for the runtime revision. | [CI](ci.txt)                                                                     |

The semantic regression opens the card by its existing accessible label and requires a visible **Rename session** menu item. With only `session-navigation/sidebar.tsx` replaced by the original main version (`030f54b7`), the same test [fails](baseline-browser.txt) because the menu has only settings, binding and archive. Restoring the fixed component [passes](fixed-menu-browser.txt). This is a component source comparison against the same daemon/test fixture, not a claim that an entire old daemon was tested.

No full local suite ran. The specified Reviewer identified an unstable workspace picker callback, an invalid JSDOM hook test, and a context-loading gate that also locked out unsupported/error states. The callback follows stable workspace identity, the JSDOM addition was removed, and basic operations now remain available when context cannot load. The real browser refresh and capability/error regressions cover those findings. Final review is tracked in WORK-390.

Multica's GitHub integration is not configured for this workspace, so the formal PR card is not linked. Root verified that platform gap and accepted the GitHub URL, remote source/base and complete diff as the review handoff. This delivery does not configure the integration, merge, deploy or restart the production daemon.

## Shared archive callers

The shared hook now changes local archive/history state after success. Pending is still shared, and server updates remain authoritative. The card's failed request keeps its row, tab and focus. These pre-existing caller choices remain distinct:

| Caller                    | Pending and layout ownership                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session card              | Keeps the row and existing tabs pending confirmation; failure stays in the row and toast.                                                                            |
| Workspace tab close       | Explicitly closes the requested root tab before requesting archive. Subagent tab close stays layout-only. A refusal does not undo that explicit close.               |
| Agent panel slash command | Hides/unpins and closes or replaces its current tab before awaiting archive.                                                                                         |
| History agent list        | Dismisses its action sheet; list/history state follows archive success. Existing request-error handling is unchanged.                                                |
| Managed subagent track    | Filters pending IDs, so rows hide while pending and return on failure. Per-row archive reports errors; Archive finished owns progress and retry.                     |
| Workspace bulk close      | Retains its existing tab-close policy and cleanup owner; layout-only subagents enter the shared archive hook only if their close policy changes to archive-on-close. |

These checks do not claim that all old archive surfaces preserve a tab or expose the card's error treatment. Worktree and workspace archive behavior is outside this change.
