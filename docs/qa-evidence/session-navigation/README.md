# Session navigation (WORK-372)

Baseline: `b5990e70351fc29f9b2be74e64b55459f45edc22`. Production revision: `58d5891c0f34ab8a4a5224480cca7c7149796756`. The following delivery commit updates evidence only.

The default sidebar has one root session per row, with SessionContext project, pin, label and directory metadata. Directory targets retain the owning session and source binding through navigation and review drafts. Git file operations use the parsed checkout root. Execution cwd, workspace ownership and provider state stay separate. Container archive and base-branch management remain in the resource entry.

## Verification

| Check                                                           | Result                                          | Raw output                                                   |
| --------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| Default server build, including TypeScript `tsc`                | Passed                                          | [build-server.txt](build-server.txt)                         |
| Workspace typecheck, lint and formatting                        | Passed                                          | [commit-checks.txt](commit-checks.txt), [lint.txt](lint.txt) |
| Eleven affected app unit suites                                 | 227 passed                                      | [unit-tests.txt](unit-tests.txt)                             |
| Existing SDK session-context contract                           | Passed                                          | [client-test.txt](client-test.txt)                           |
| Three affected browser files, including the entire Model B file | 10 passed                                       | [browser-tests.txt](browser-tests.txt)                       |
| Independent review                                              | Taste: Good; no unresolved correctness blockers | [review.md](review.md)                                       |

Browser cases cover two root sessions in one workspace; wide and compact layouts; cross-repository and non-Git bindings; invalid binding and retry; expired binding removal; resources without a root session; nested checkout-root file attachments; old resource grouping; compact action sheets; and published daemon 0.8.0. They assert the actual Files/Changes surface and retained execution directory, rather than matching a path elsewhere on the page.

Unit regressions cover failed refresh without reading a stale Git snapshot, PR URL routing, container-action filtering, new-to-old host cache gating, cross-host legacy pin order, directory-state identities, nested attachment/review scopes, keyboard targets and translation parity/placeholders for all nine locales.

The tests use isolated real daemons, real filesystem/Git and the existing deterministic provider adapter. Browser: Chromium 140.0.7339.16 on Linux. A temporary local Playwright launch configuration selected the installed browser; the checked-in test definitions use the normal repository runner. Product Git/forge write actions were not exercised; PR publication was limited to this delivery. No merge, deployment or production daemon restart was performed.

## Screenshots

[Wide, 1200 × 900](wide.png) and [compact, 390 × 900](narrow.png) were captured after binding and expanding directories through the actual app.

## Delivery boundaries

Native iOS/Android and packaged Electron on macOS/Windows/Linux were not exercised. Compact evidence is a narrow real browser. No full test suite was run; PR/MR children, remote diffs and execution-directory switching remain outside this change.

PR: <https://github.com/zfan2356/paseo/pull/12>. The GitHub connector denied PR creation with 403; the repository's existing authenticated CLI created the PR. Multica's formal PR-card association returned 404 twice. The project has the `https://github.com/zfan2356/paseo` repository resource, but PR #12 has not been imported into its card index; association remains a platform delivery gap. The run's accepted upstream return relationship is independent of that association.
