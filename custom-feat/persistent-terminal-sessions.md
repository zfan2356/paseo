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

PTY ownership now uses upstream's detached worker, authenticated framed socket,
process records, cleanup reaper, runtime copies and protocol-version draining
from `#7644`. The fork keeps the following overlay:

- Graceful daemon shutdown _detaches_ from the worker instead of killing it.
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

New workers receive the current daemon environment and CLI path on every
terminal creation. Linked conversation identity, activity tokens and explicit
titles survive adoption. Requests reply only to their originating connection;
terminal events reach every attached daemon.

`legacy-worker-connection.ts` adapts an already-running fork NDJSON worker's
attach response to upstream's listing contract. It never launches another
legacy worker, replaces its PTYs or bypasses authentication. After it exits,
the next daemon start uses the upstream backend.

### Explicit non-goals / limitations

- No durability across machine reboot or worker crash. Upstream drains the
  previous protocol and closes obsolete workers; newer incompatible workers
  remain untouched and report an explicit incompatibility.
- Only an adopted legacy NDJSON worker retains its older daemon environment;
  agent-linked terminals still pin their critical values through request env.
- Activity hooks report to the daemon HTTP endpoint; reports with no daemon
  listening are dropped.
- No second tmux-based keepalive path — this design is the only one.

An unspecified graceful daemon shutdown still keeps terminals in this fork.
Explicit close requests, including `daemon stop` and `restart --kill-terminals`,
use upstream's cleanup semantics. Deployment and production restarts require
separate consent.

Automatic conversation handoff on top of this is owned by
[agent-tui-conversation-switch.md](agent-tui-conversation-switch.md); the
clean-reopen experience is owned by
[viewport-only-terminal-restore.md](viewport-only-terminal-restore.md).
