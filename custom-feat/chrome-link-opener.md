# Host-window links open in Google Chrome

- Status: active
- Commits: `9eff10ccd`
- Ledger entry: "Host-window links open in Google Chrome"

## Original requirement

Clicking an http(s) link in chat, a terminal, or settings either spawned a
bare Electron window or navigated the Paseo host renderer away. The
requirement: links from the Paseo host window should open in the user's real
browser — specifically Google Chrome on macOS — and never take over the
Paseo window.

## Design

- A desktop opener feature (`packages/desktop/src/features/opener.ts`)
  intercepts host-renderer http(s) navigations and `window.open`
  (main-window `setWindowOpenHandler` + `will-navigate`).
- On macOS it opens the URL in Chrome via Launch Services bundle id
  `com.google.chrome`; if Chrome is missing it falls back to the system
  default browser through `shell.openExternal`.
- Scope is deliberately narrow: packaged `paseo://` navigations and the Expo
  dev-server origin stay in the host window, and **in-app browser guest
  tabs keep the upstream policy** (ordinary opens become workspace tabs,
  real popups stay secured Electron child windows).
- If upstream ever adds a link-open setting, keep Chrome as the macOS
  default here and keep guest-tab policy separate.
