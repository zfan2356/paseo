# Terminal color isolation

- Status: active
- Commits: `39bc7c770`
- Ledger entry: "Terminal color isolation"

## Original requirement

Terminals opened inside Paseo looked worse than a native terminal: programs
rendered without color or with a reduced palette. The cause was the daemon's
own process environment leaking into every PTY it spawned — variables like
`NO_COLOR` or a conservative `TERM` set for the daemon were inherited by the
user's shells and TUIs. The requirement: a Paseo terminal should present
itself as a modern truecolor terminal, regardless of how the daemon was
launched.

## Design

Terminal environment construction (`buildTerminalEnvironment` in
`packages/server/src/terminal/terminal.ts`) applies a fixed contract instead
of raw inheritance:

- Advertise `TERM=xterm-256color`, `TERM_PROGRAM=kitty`, and
  `COLORTERM=truecolor` so programs enable truecolor and kitty-aware
  features (the renderer actually supports these — see
  [kitty-graphics-ack.md](kitty-graphics-ack.md)).
- Strip daemon-level color-policy variables (`NO_COLOR`, `FORCE_COLOR`,
  `CLICOLOR`, `CLICOLOR_FORCE`) so they never leak into a terminal.
- Values explicitly supplied for a specific terminal still win — the filter
  only removes what the terminal creator did not ask for.

This is a policy at the single environment-construction seam, not a fork of
the shell-spawning path, so upstream refactors around it merge cleanly as
long as the three behaviors above are preserved.
