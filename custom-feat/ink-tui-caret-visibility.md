# Ink TUI caret visibility

- Status: active
- Commits: `81a48eb12`, `52b977b00`, `253b3a006`
- Ledger entry: "Ink TUI caret visibility"

## Original requirement

In Ink-based TUIs (Claude Code, Codex) rendered by the web/Electron xterm
WebGL renderer, the input caret was invisible — especially on the Pure Black
theme. Ink draws its caret as an inverse-video space in default colors, and
the WebGL renderer skips filling default-background cells, so the "caret"
cell rendered as nothing. The requirement: a visible caret in Ink TUIs, in
all themes, without breaking colored inverse text.

## Design

- SGR rewrite (`inverse-sgr.ts`): inverse+default-color spaces are rewritten
  with **explicit swapped theme RGB**, forcing WebGL to fill the cell.
  Inverse spans that already carry palette or explicit RGB colors are left
  untouched.
- Hardware caret: a non-blinking bar, kept as a bar while the pane is
  unfocused too — the default unfocused outline style disappears on Pure
  Black.
- Renderer robustness fixes that fell out of the investigation:
  - a retained panel hidden via `display:none` and shown again
    force-refreshes visible rows even at unchanged fitted size, repainting a
    WebGL canvas that the hide cleared;
  - a WebGL context loss disposes and reloads the addon instead of leaving a
    blank canvas.
- Deliberately reverted: the 2026-08-16 hardware-cursor parking /
  force-show / `→` prompt-fallback experiments. Hide-cursor sequences,
  DECSCUSR, and leftover cursor position are left to xterm. Do not
  reintroduce parking without an explicit new request.

### Limitations

Native grid rendering already swaps inverse fg/bg and does not need this.
The bundled native webview receives the same runtime but was not exercised
on a physical device. An Ink TUI that hides the hardware cursor _and_ draws
only a default-color inverse space can still look caret-less on WebGL after
a hide sequence.
