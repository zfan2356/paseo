# Antigravity Side Chat and Agent/TUI switching

- Status: active in source; deployment requires refreshing the affected clients
- Ledger entry: "Antigravity conversation surfaces"

## Original requirement

Use Antigravity through the existing iChat Gemini 3.8 Flash route with the same
Side Chat and Agent/TUI affordances as the other supported providers. A side
conversation must inherit a snapshot without changing the parent. A TUI switch
must resume the same native conversation and show its new turns back in Agent.

## Design

Official ACP 1.1.1 and CLI 1.2.6 use compatible SQLite conversation databases,
but different storage directories. The maintained `ichat-proxy` package in
`dev-skills` owns the native-session adaptation, beside its model protocol bridge:

- `antigravity_acp.py` forwards ACP messages and implements `session/fork` by
  taking a SQLite backup of the source, including committed WAL pages. It gives
  the snapshot a new conversation identity and advertises the existing ACP fork
  capability. Paseo's existing generic ACP Side Chat flow owns history, visibility,
  independent lifecycle, and parent association; no new Paseo RPC is added.
- A snapshot is the database state committed when the backup is taken. Later
  parent updates do not propagate to it. Workspace files remain shared, as they
  do for other conversation forks. Native step payloads and provenance remain
  intact; Google's executable is not patched.
- `antigravity_sessions.py` links only the selected ACP database and its scratch
  directory into the CLI store. It refuses existing unrelated destinations.
  A process-held lock excludes the ACP and linked CLI writers. There is no
  copy-back phase that could overwrite newer history.
- `antigravity-acp-ichat --tui <session-id>` launches the official CLI with that
  same id and iChat environment. ACP resume after TUI exit replays the updated
  database, including turns entered in the terminal.

The fork adds `antigravity` to the existing terminal-provider list and the
client's conversation-surface eligibility. The fork-owned
`packages/server/src/terminal/antigravity-conversation.ts` translates model and
permission settings into the wrapper's launch arguments. Existing PTY ownership,
exclusive Agent claims, tab retargeting, and resume behavior stay unchanged.

This provider contract requires the maintained wrapper, not an arbitrary binary
named Antigravity. Side Chat needs the updated wrapper on its next process start;
the TUI entry point also needs the updated daemon and frontend. Preserve the
official version pins until the round-trip test passes against an upgrade.

## Validation

- Bridge unit tests exercise WAL snapshots, parent isolation, path validation,
  write exclusion, existing-file conflicts, capability advertisement, and failed
  resume cleanup.
- An isolated native probe exercises a fork during an active parent prompt,
  parent/side independence, official CLI continuation, and ACP replay afterward.
- `packages/app/e2e/browser/antigravity-conversation.real.spec.ts` exercises the
  Side Chat UI and refresh, the actual CLI in a PTY, and return to Agent history.
- `codex-fork-terminal.test.ts` and `conversation-surface/session.test.ts` cover
  launch arguments, environment inheritance, and eligibility.
