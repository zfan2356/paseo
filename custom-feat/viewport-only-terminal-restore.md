# Viewport-only terminal restore

- Status: active
- Commits: `21b986f04`, `e9bdb1885`
- Ledger entry: "Viewport-only terminal restore"

## Original requirement

Reopening a long-lived terminal (especially a TUI with lots of scrollback,
which [persistent-terminal-sessions.md](persistent-terminal-sessions.md) made
common) replayed the entire scrollback as ANSI that xterm parsed top-down —
visibly scrolling junk for seconds before settling. The requirement: opening
an existing terminal should paint the current screen, instantly and without
visible replay.

## Design

- Restore-aware clients request `visible-snapshot` with `scrollbackLines: 0`
  (`terminal-restore-options.ts`, server `terminal-restore.ts`): only the
  current viewport is encoded, nothing older.
- Two visibility barriers guarantee no mid-restore frame is ever seen:
  - the stream controller keeps `isAttaching` true until the **restore frame
    arrives** (not merely until `subscribeTerminal` resolves), and the attach
    overlay uses the opaque pane background;
  - the emulator host stays at `opacity: 0` from `restoreOutput` enqueue
    until that write **commits**, so the viewport paint itself is invisible
    while parsing.
- Live-restore mode still skips the restore frame; subscribe errors and
  terminal exit always clear the attach cover.
- A mounted pane keeps its subscription while the renderer is ready: focus
  and retained-panel visibility gate only size claims and the overlay.
  Output/restore/snapshot events keep applying to the hidden emulator, so a
  retained TUI tab does not restore again on click.
- Promoting a live stream to visible-snapshot after output overflow also
  uses `scrollbackLines: 0`.

Trade-off accepted: no scrollback history after a reopen — the viewport is
the restore surface; history stays in the TUI/shell itself.
