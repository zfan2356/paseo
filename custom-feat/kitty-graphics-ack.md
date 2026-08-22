# Kitty graphics replies stay off the prompt

- Status: active
- Commits: `52b977b00`
- Ledger entry: "Kitty graphics replies stay off the prompt"

## Original requirement

Because Paseo terminals advertise `TERM_PROGRAM=kitty` (see
[terminal-color-isolation.md](terminal-color-isolation.md)), programs probe
the Kitty graphics protocol. The renderer's ImageAddon answered those probes
through xterm `onData` — the reply took the same path as keystrokes, so
`_Gi=<id>;OK` literally appeared typed at the prompt of an idle Ink TUI. The
requirement: keep Kitty graphics support without ACK text ever reaching the
prompt.

## Design

- The **daemon** answers Kitty graphics APC queries (`ESC _ G ... ST`) on
  PTY stdin, exactly the way it already answers DA1
  (`kitty-graphics-protocol.ts`, wired in `terminal.ts`). Quiet queries
  (`q=1` / `q=2`) and already-complete responses are not acked.
- The **renderer** never forwards ImageAddon ACKs through `onData`
  (`terminal-protocol-reply.ts`); ImageAddon size reports are disabled.
  Image display still consumes APC data from PTY output normally.
- One ACK path, server-side — if upstream ever adds Kitty graphics
  handling, keep the stdin ACK on the daemon and zero renderer `onData`
  replies.

### Limitation

The headless daemon xterm has no APC parser, so replies are scanned from raw
PTY bytes; a query split across the 1 MB pending cap is dropped.
