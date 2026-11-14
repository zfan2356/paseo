# Session navigation repair (WORK-374)

PR: <https://github.com/zfan2356/paseo/pull/13>. Base: `9d403c2b0b18b573eb6e12940a051b5cb72fdde5`. Contract v3.

Sessions and Directories and terminals switch at the top and each own the list area. Pinned sessions have one independent, ordered, collapsible section, subject to the same filters as ordinary sessions. Main-checkout and linked-worktree sessions default to the primary repository project; explicit project choices and execution cwd stay independent. The composer folder button shows a short distinct name and reveals the full execution path on click or desktop hover.

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

[Desktop hover](execution-directory-hover-1200.png) also exposes the full execution path. Captures were inspected after modal close settled, with pins collapsed for the repository-group captures.

## Compatibility and coverage

The accepted legacy assignment boundary is defined in [the session navigation design](../../session-context.md). You can select a project or ungroup a session from its session settings; later automatic reads preserve that choice.

Native iOS/Android and packaged Electron were not exercised. Narrow-browser evidence proves the compact web flow. No full local test suite, merge, deployment or production daemon restart was performed. Independent review is recorded on WORK-380 and PR #13 for the delivered revision. Remote CI is blocked: explicit workflow dispatch returned HTTP 422, `Actions has been disabled for this repository`; the branch has no checks or runs. See [remote CI output](remote-ci.txt). Multica PR-card association returned 404 twice because PR #13 has not been synced into the platform index; the GitHub PR exists and is Ready.
