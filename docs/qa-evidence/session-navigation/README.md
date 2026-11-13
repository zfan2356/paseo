# Session navigation (WORK-372)

Baseline: `b5990e70351fc29f9b2be74e64b55459f45edc22`.

The default sidebar uses a root session per row and SessionContext for project, pin, labels and directories. Explicit directory targets retain the owning session and actual path through Files, Changes, file tabs, side opens and commit diffs. They leave execution cwd and workspace ownership intact. Directories and terminals preserves the container resource view.

## Evidence

- [Wide browser](wide.png), 1200 × 900.
- [Compact browser](narrow.png), 390 × 900.
- [Default server build](build-server.txt): `npm run build:server`, including default TypeScript `tsc`.
- [Workspace type checks](typecheck.txt): `npm run typecheck`.
- [App unit tests](unit-tests.txt): the nine changed model, identity, scope, path, review, attachment and keyboard suites.
- [SDK context contract](client-test.txt): the existing session context test, including the old-host gate and observation reconnect.
- [Lint](lint.txt): `npm run lint`.

The browser tests use real isolated daemons, real filesystem/Git and the existing deterministic provider adapter. No forge write or production daemon restart was performed. Browser: Chromium 140.0.7339.16 on Linux. The workstation's installed browser was selected by a temporary Playwright launch configuration; the test definitions remain in the existing browser suite.

The targeted browser cases cover two sessions in one workspace, cross-repository binding, non-Git directories, invalid binding and retry, an expired binding and removal, a terminal container without a root session, and published daemon 0.8.0. Width-specific tests assert the actual Files surface and retained execution cwd, rather than matching a path elsewhere in the page.

## Boundaries

No full workspace test suite was run. Native iOS/Android and packaged Electron on macOS/Windows/Linux were not exercised; compact evidence is a real narrow browser. PR/MR children, remote diffs and execution-directory switching remain outside this change.

Directory Git facts use shared host/path queries and an explicit daemon refresh only for expanded visible sessions; the sidebar creates no directory watcher per association. Session context observations are collection-owned and release when the sidebar and its keyboard consumer are inactive. File/Changes observations retain their existing visible-panel ownership.

The first aggregate browser run passed both widths, the terminal resource and published old daemon; the expired-binding test exposed a missing button role on its action trigger. [That case passes after the fix](browser-expired.txt). The initial aggregate output is retained in [browser-initial.txt](browser-initial.txt).
