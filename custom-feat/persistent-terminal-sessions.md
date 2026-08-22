# Persistent terminal sessions

- Status: active
- Commits: `94e1fdedd`, merge `d758e0395`, `b417f2e09`
- Ledger entry: "Persistent terminal sessions"

## Original requirement

Restarting the Paseo daemon (upgrade, crash, config change) killed every
terminal and every foreground process in them — including long-running Codex
TUI sessions. On a machine where the daemon is the development hub, that made
daemon restarts destructive. The requirement: terminals must survive daemon
restarts and be reattachable afterwards from desktop and mobile, without
resorting to tmux.

## Design

Ownership of PTYs moves out of the daemon into a **detached terminal worker
process**, connected over an authenticated local socket with an NDJSON,
versioned protocol (`terminal-worker-*.ts`, `worker-terminal-manager.ts`):

- Graceful daemon shutdown *detaches* from the worker instead of killing it.
  PTYs, foreground commands, and TUIs keep running; the next daemon
  rediscovers and re-attaches.
- During a restart, old and replacement daemons may both be attached, so a
  failed replacement does not disconnect the daemon still serving clients.
- Output produced while no daemon is attached accumulates in headless
  terminal state and appears in the next snapshot; clients (desktop and
  mobile) reopen the same terminal and keep typing.
- Snapshots preserve xterm cell widths so wide CJK/emoji continuation cells
  are not replayed as visible spaces; the daemon also tolerates the implicit
  spacer shape of older workers until they age out.
- A compact/mobile client that merely opens or restores a terminal stays a
  passive viewer and does not steal the PTY size from a desktop client;
  direct interaction can still claim ownership intentionally.

### Explicit non-goals / limitations

- No durability across machine reboot, worker crash, or an incompatible
  worker-protocol version (a version bump uses a new endpoint; an old worker
  with live terminals stays running but unreachable until they exit).
- A reused worker keeps the environment of the daemon that launched it, so
  post-restart terminals can inherit stale globals; agent-linked terminals
  pin their critical values through the request env.
- Activity hooks report to the daemon HTTP endpoint; reports with no daemon
  listening are dropped.
- No second tmux-based keepalive path — this design is the only one.

Automatic conversation handoff on top of this is owned by
[agent-tui-conversation-switch.md](agent-tui-conversation-switch.md); the
clean-reopen experience is owned by
[viewport-only-terminal-restore.md](viewport-only-terminal-restore.md).
