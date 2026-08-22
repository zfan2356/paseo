# Clipboard image paste in Codex terminals

- Status: active
- Commits: `a3132bb37`
- Ledger entry: "Clipboard image paste in Codex terminals"

## Original requirement

The Paseo agent composer accepts a pasted screenshot; a Codex conversation
terminal did not — pasting an image into the TUI either did nothing or
required saving to a file first. The requirement: `Ctrl/Cmd+V` a clipboard
image straight into a Codex conversation terminal from desktop, and from a
phone via the terminal Paste button, with the image ending up as a native
Codex attachment.

## Design

- Capture: the desktop/Electron terminal intercepts clipboard **raster
  image** items on paste (same items as the composer). The native/mobile
  Paste button reads clipboard images through Expo Clipboard before falling
  back to text paste, so a phone can upload its own clipboard image to the
  host running Codex.
- Transfer: the image goes through the existing binary file-upload channel
  to the daemon (retained under `PASEO_HOME/uploads`, because Codex history
  can refer back to the path). Paseo then **bracket-pastes the returned host
  path** into Codex; Codex owns attachment parsing and shows its native
  `[Image #N]` placeholder. Image bytes never pass through the PTY.
- Limits/UX: 50 MB cap; visible uploading / success / failure states.
  Ordinary text paste is unchanged; blank terminals and non-Codex profiles
  do not intercept images.
- Gating: fail-closed across mixed versions via the optional
  `codexTerminalImagePaste` server feature plus a per-terminal
  `capabilities.imagePaste` field. The daemon derives that capability from
  the server-owned Codex conversation association and its internal encoded
  terminal name — deliberately avoiding a terminal-worker protocol bump so
  live version-1 worker terminals keep working.

### Limitations

Exercised end-to-end against Codex CLI 0.144.5 on desktop (asserting the
real `[Image #1]` placeholder). iOS/Android share the pipeline but were not
verified on a physical device.
