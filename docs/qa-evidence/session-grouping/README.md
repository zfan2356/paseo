# Session grouping and directory resources

WORK-396, contract v2. The sidebar shows the same compact session cards under By project or By directory. Both retain one ordered Pinned section. Project icons and state badges belong to each session's actual project; cards reuse the workspace row's title and icon rails. Rename, pin, labels, read, archive, hover and context menus keep their existing operation targets.

Directory selection, binding, removal and worktree creation live in Explorer's Files/Changes context. A default panel follows that session's saved browsing directory. Explicit file and diff targets keep their session/path scope. Git operations resolve a nested directory to its checkout root; the composer still names the original execution cwd.

Workspaces and terminals opens the original global workspace list from Explorer and from Open project. Choosing a row uses its existing workspace ID and layout. No session is manufactured for a terminal or service.

## Browser evidence

Real isolated daemon and Metro, Linux headless Chromium 140. Pointer viewports are 1200×1000 and 390×1000. A separate 390 context enables real browser touch (`hasTouch`, `isMobile`), asserts fine-pointer=false and taps its controls. Compact menu/sheet tests locate content separately from the header test ID, matching the existing sheet host contract. Screenshots wait for menu ancestor opacity and geometry to settle where relevant.

| Surface                                      | 1200                                  | 390                                  |
| -------------------------------------------- | ------------------------------------- | ------------------------------------ |
| Project grouping                             | [project](group-project-1200.png)     | [project](group-project-390.png)     |
| Directory grouping                           | [directory](group-directory-1200.png) | [directory](group-directory-390.png) |
| Workspaces and terminals sheet               | [sheet](workspace-resources-1200.png) | [sheet](workspace-resources-390.png) |
| Bound directory browsing                     | [files](linked-directory-1200.png)    | [files](linked-directory-390.png)    |
| Open project after all sessions are archived | [home](empty-sessions-home-1200.png)  | [home](empty-sessions-home-390.png)  |

The [compact terminal surface](independent-terminal-390.png) remains usable after choosing another workspace; compact tabs use their existing switcher rather than the desktop tab rail.

The matrix uses two Git projects, a main checkout plus a real linked worktree, a non-Git directory, cross-project pins and an independent terminal workspace. It switches grouping without changing session context, selection or pin order; binds/chooses/removes a second path on both widths; checks file content and composer cwd; opens the original terminal; archives all five sessions; then reopens that terminal from Open project and closes the compact resource sheet.

The service regression starts a real HTTP service, switches to another conversation, selects the original workspace again, requires the resource sheet to close, and compares terminal IDs before and after. It verifies that the service workspace has no agent, the original conversation keeps its cwd, and stopping the service still works. [Running service](workspace-resource-service-1200.png).

The existing session-card matrix also covers same-directory operation isolation, rename/pin/read/label failures, read-only and offline states, label creation and assignment, authoritative archive/history, unsupported/error context, pending archive and sibling/launcher focus. The status case now checks the reused project badge instead of the removed standalone six-pixel dot. Touch titles have a 44px hit target; menus remain separate controls.

## Validation

Runtime source: `ee9a65365d57a559daa62e58d8015fc38407da20` (including `58ce057c4a69207abb70ab2bfd8990bcc2417ef9`); base `b60da86b9d695b2274e870d13fe7f4426b75892d`. [PR #18](https://github.com/zfan2356/paseo/pull/18) targets main. The following evidence commit adds this record and artifacts; it does not change runtime code. Independent review is WORK-399.

| Check                                                                                  | Result                                   | Raw output                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------- |
| Session projection/model                                                               | 13 passed                                | [model](model.txt)                    |
| Full workspace typecheck                                                               | Passed                                   | [typecheck](typecheck.txt)            |
| Full lint                                                                              | Passed                                   | [lint](lint.txt)                      |
| Server/declaration build                                                               | Passed                                   | [build](build-server.txt)             |
| Commit hooks: format, lint, full typecheck                                             | Passed                                   | [hooks](commit-checks.txt)            |
| Initial focused browser matrix                                                         | 13 passed, 2 failed                      | [matrix](browser-matrix.txt)          |
| Targeted follow-up plus original resource projection                                   | 6 passed, service sheet dismissal failed | [follow-up](browser-final.txt)        |
| Resource dismissal fix: original project/status rows, complete matrix, running service | 5 passed                                 | [regression](resource-regression.txt) |

The initial failures were the obsolete six-pixel-dot assertion and a compact test clicking the retained header's Explorer toggle. The targeted run corrects both and exercises the complete grouping/empty-session matrix. It also covers the original resource projection and touch title geometry. The service failure exposed an existing workspace row callback that was accepted but never called. Restoring that callback before navigation closes the new resource sheet even when the destination workspace is retained. The final regression asserts sheet dismissal; a terminal visible behind a modal is insufficient evidence. These are focused files/cases, not a full local test suite.

GitHub Actions is a known disabled-repository exemption in the task contract. There are no runs for the runtime head; reading Actions permissions returns 403. Neither is a passing CI result. Multica PR binding returned 404 because the repository/PR is not synced, and the relation list remains empty; the task explicitly exempts that integration gap.

Web is exercised. iOS, Android and packaged Electron on Linux/macOS/Windows are not exercised; these results do not establish native gestures, native sheet ancestry or packaged desktop behavior. Provider authentication and production daemon availability are outside the isolated fixture. No production daemon restart, merge or deployment is part of this delivery.
