# Session navigation repair (WORK-374)

Implementation: [PR #13](https://github.com/zfan2356/paseo/pull/13), merged as `dbd5138f1c4ea0e7ff66a5211a0c5575270cdcba`. Sidebar evidence follow-up: <https://github.com/zfan2356/paseo/pull/14>. Contract v3.

Sessions and Directories and terminals switch at the top and each own the list area. Pinned sessions have one independent, ordered, collapsible section, subject to the same filters as ordinary sessions. Main-checkout and linked-worktree sessions default to the primary repository project; explicit project choices and execution cwd stay independent. The composer folder button lives in the input toolbar and reveals the full execution path on click or desktop hover. Current toolbar and per-session status evidence is in the [toolbar follow-up](../session-toolbar-state/README.md).

## Validation

| Check                                              | Result                                              | Raw output                                                                                   |
| -------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Server build                                       | Passed                                              | [build-server.txt](build-server.txt)                                                         |
| Workspace typecheck, lint, format and commit hooks | Passed                                              | [typecheck.txt](typecheck.txt), [lint.txt](lint.txt), [commit-checks.txt](commit-checks.txt) |
| Session model                                      | 12 passed                                           | [model-test.txt](model-test.txt)                                                             |
| Session context store                              | 16 passed                                           | [context-store-test.txt](context-store-test.txt)                                             |
| Real Git path handling                             | 3 passed                                            | [git-test.txt](git-test.txt)                                                                 |
| Isolated daemon context                            | 2 passed                                            | [context-daemon-test.txt](context-daemon-test.txt)                                           |
| Existing sidebar browser cases                     | 8 passed                                            | [browser-existing.txt](browser-existing.txt)                                                 |
| Nine-pin/worktree browser combination              | Passed at both widths                               | [browser-combination.txt](browser-combination.txt)                                           |
| Pin regression against base projection             | Expected failure: pins remain inside ordinary group | [pins-baseline-red.txt](pins-baseline-red.txt)                                               |

The full browser-file log includes a combination-test locator failure; the final targeted combination run supersedes that result. All eight other cases passed. Tests use the existing Playwright fixtures, real isolated daemons, temporary filesystem/Git repositories and the deterministic provider adapter. No production state was changed. Browser: Chromium 140 on Linux; viewport widths 1200 and 390, height 1000. The local launch configuration selects the installed Chromium binary; checked-in tests retain the normal repository runner.

The combination creates a primary checkout on `trunk` with no remote, two external linked worktrees, two independent repositories, a non-Git project and nine pins. It verifies primary-project membership through the daemon and actual rendered group, list exclusivity, collapse/reopen, unpin without duplicate rows, preserved execution label, click-to-view directory details and desktop hover. Unit cases cover legacy non-null inherited assignment, manual assignment including ungrouped, missing workspace, unavailable Git facts, repeat reads, binding without reassignment, status/label/search filtering and directory-name collisions. Bare repositories without a primary checkout retain their existing group.

## Screenshots

| Surface                                 | Wide                                           | Narrow                                       |
| --------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| Nine pins and top switch                | [1200px](pinned-sessions-1200.png)             | [390px](pinned-sessions-390.png)             |
| Primary checkout and worktrees together | [1200px](session-repositories-1200.png)        | [390px](session-repositories-390.png)        |
| Complete directory/terminal list        | [1200px](directory-resources-1200.png)         | [390px](directory-resources-390.png)         |
| Compact execution folder button         | [1200px](execution-directory-1200.png)         | [390px](execution-directory-390.png)         |
| Execution path on click                 | [1200px](execution-directory-details-1200.png) | [390px](execution-directory-details-390.png) |

[Desktop hover](execution-directory-hover-1200.png) also exposes the full execution path. The sidebar captures require the full list, both top segments, the Pinned title and the New workspace button/icon to be inside the viewport. Six consecutive animation frames then confirm identical list geometry at the left anchor `x = 0`. [Wide geometry](sidebar-geometry-1200.json) and [narrow geometry](sidebar-geometry-390.json) preserve the opening bounds and settled samples. The sidebars in both Pinned captures were visually checked, including their left edges. Directory details wait for a settled, fully visible path; repository-group captures collapse pins.

The [prior narrow capture](https://github.com/zfan2356/paseo/blob/25a452dfacc95f05ff78b0a74f823804c982a632/docs/qa-evidence/session-navigation-repair/pinned-sessions-390.png) caught the overlay moving into place. The same scenario with the geometry assertions shows the complete panel at rest. This correction changes the test and evidence; production layout remains unchanged from `25a452df`.

## Compatibility and coverage

The accepted legacy assignment boundary is defined in [the session navigation design](../../session-context.md). You can select a project or ungroup a session from its session settings; later automatic reads preserve that choice.

Native iOS/Android and packaged Electron were not exercised. Narrow-browser evidence proves the compact web flow. No full local test suite, merge, deployment or production daemon restart was performed. Independent review is recorded on WORK-380 and the evidence follow-up PR for the delivered revision. Remote CI is blocked: explicit workflow dispatch returned HTTP 422, `Actions has been disabled for this repository`; the branch has no checks or runs. See [remote CI output](remote-ci.txt). Multica PR-card association returned 404 for the implementation PR because it has not been synced into the platform index. The follow-up PR records its current association status separately.
