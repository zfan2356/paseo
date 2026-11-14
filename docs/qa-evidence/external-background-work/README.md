# External background work QA

[WORK-401](http://21.6.29.118:3210/multica-trial/issues/WORK-401) connects the existing
background-work list to Multica daemon waits. The companion changes are
[Paseo #20](https://github.com/zfan2356/paseo/pull/20) and
[Multica #37](https://github.com/junjzhang/multica/pull/37).

## Revisions and environment

The final manual run used Paseo code `406e0b0fc88c78cb4459add90934f78d14df3628`,
including main `f98e625e0adb5cd05638ac983a571420b3666469`, and Multica plugin code
`7a94a51653047d90d9f884de847dbdb325fa2e1b`, including
`feat/task-session-delivery` at `0939dfe4e8f9f634076a48c43d39f9645ce76cb0`.
These bases include the WORK398 theme changes. The feature implementation was
independently reviewed at Paseo `6d3e15bf9a9a7f09c83df50007d2e8e51d87e6f4`;
the later sync preserved it. Later evidence, assertion cleanup and a guard that
freezes unlisted stop-attempt rows leave the successful listed-row flows exercised
here unchanged. The final public RPC guard also rejects internal agents; its
regression failed before the guard and passed after it.

The run used a dedicated PostgreSQL database, local Multica API/account/workspace,
explicit CLI profile and daemon ID, a separate Paseo home and port, and real
Claude Code/Codex providers. Claude ran only the requested background sleep; its
permission was approved for that exact command. The app was exported from this
checkout and served by the isolated Paseo daemon. Browser automation used the
installed Linux Chromium headless shell (build 1187) through Playwright.

The final daemon environment disabled GC and self-update and set an owned
`MULTICA_AGENT_TEMP_BASE`. The harness stopped its children, disconnected the test
bindings and removed its profile in `finally`. No production restart or user-wait
cancellation was performed.

## Results

[Raw output](qa-output.log) and the [run manifest](run.json) record the executed
revisions and test session/wait IDs. The manual harness is retained in the task
checkout at `.dev/work401/bridge-qa.mts`.

| Check                                                | Result                                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Register waits in original Claude and Codex sessions | Passed; frozen registered session IDs mapped to the correct host/agent                                                            |
| Cross-session isolation and explicitly bound Issue   | Passed; each session saw its own wait and the Issue URL matched the bound test Issue                                              |
| Native and external work coexist                     | Passed; real Claude Bash background sleep and the Multica wait appeared together                                                  |
| Cancel local wait                                    | Passed; only the selected curl monitor ended; a separate HTTP workload kept advancing and the other session's wait stayed running |
| End, enqueue, deliver, handle                        | Passed; terminal wait remained visible, delivery reached the frozen original Paseo session, recipient ACK removed it              |
| Browser reload/reconnect                             | Passed; inventory returned without re-registering the wait                                                                        |
| Plugin reload                                        | Passed; rebuilt from the external inventory                                                                                       |
| Multica daemon offline/restart                       | Passed; stale cache while offline, then existing lost semantics after restart                                                     |
| Paseo daemon restart                                 | Passed; same host/session identity, rebuilt list and summary, including the Codex app panel                                       |
| Multica server offline/recovery                      | Passed; stale rows with no controls, then reconciled inventory and fresh cancellation tokens                                      |
| Old client and read-only client                      | Passed in the real subprocess/WebSocket regression; native-only projection, hidden controls and rejected forged read-only stop    |
| Plugin crash/reload/removal                          | Passed in the real subprocess/WebSocket regression; stale retention and explicit cleanup                                          |
| Closed provider runtime                              | Passed; stored summary and subscription updates retained without resuming the provider                                            |
| Pending terminal child wait                          | Passed; still counted in the list while workspace execution state remained done                                                   |

The verification workload ran as a separate HTTP process on this host. No
external CI or GPU job was launched.

## Screenshots

[Running](running.png) shows the count, native shell and Multica source together.
[Pending handling](pending.png) shows the cancelled wait retained in the same
list. [Codex after Paseo restart](codex-restarted.png) shows the reconstructed
running wait and the earlier lost wait with its independent delivery state.

| Platform                         | Coverage                                          |
| -------------------------------- | ------------------------------------------------- |
| Linux daemon and browser web     | Passed; actual daemons, providers and browser app |
| iOS / Android                    | Not run                                           |
| Electron Linux / macOS / Windows | Not run; browser proof is not Electron proof      |

## Checks

Only focused tests were run. The full suite was not run.

- Paseo background store/projection: 13 passed.
- Protocol state bucket: 13 passed.
- SDK import boundaries: 91 passed in the first slice; the later base changed no import boundary.
- Focused plugin subprocess/WebSocket integration: 1 passed, other cases deselected.
- Manager coexistence/close regression: 1 passed, other cases deselected.
- Workspace terminal-child regression: 1 passed, other cases deselected.
- Paseo server stack and browser app builds, full typecheck and lint: passed.
- Multica isolated plugin typecheck and existing service suite: passed, 35 tests.
- The isolated Multica plugin workspace has no lint script; root frontend/mobile checks were not run for this plugin-only change.

The [check output](checks.log) contains the local logs. The PRs had no
reported GitHub checks; querying repository Actions policy returned 403 for the task credentials. Explicit Multica PR association returned 404 because the
repositories were not connected/synced; the task links are not recorded PR cards.

## QA environment incident

An early test daemon used the default host GC. Its log recorded attempts to
remove unlocked `/tmp/multica-task-*` directories that failed on file permissions.
It reported no successful reclamation count; partial deletion of stale temporary
files before those failures could not be established. That test instance was
stopped. All final runs disabled GC and used a task-owned temp base. The incident
is recorded in WORK401 and the personal lesson log; it is not counted as a clean
isolation result for those early attempts.

## Delivery dependencies

Update the Paseo host and the client renderer, then reload the Multica plugin and
select the actual local daemon profile in its existing trusted connection
settings. Preserve its owner profile and delivery daemon selection. Older clients
receive native inventory only; the packaged desktop app needs a renderer update
to display external waits. Existing watch execution and Multica delivery remain
owned by Multica. Deployment and shared daemon control belong to the task's
acceptor.
