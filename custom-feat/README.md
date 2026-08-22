# Custom features

Per-feature documentation for the customizations this fork (`zfan2356/paseo`)
carries on top of `getpaseo/paseo`. One document per feature, each recording:

- **Original requirement** — the problem or wish that started the feature, as
  originally raised, before any design happened.
- **Design** — the shape of the change: approach, key modules, and the
  decisions or trade-offs that are not obvious from the diff.

## Conventions

- One feature, one file, kebab-case: `custom-feat/<feature-slug>.md`.
- Write the doc in the same change that lands the feature. A fork feature
  without a doc here is incomplete.
- When a feature is materially extended, update its doc. When upstream absorbs
  a feature, mark it `Status: absorbed by upstream` (keep the file for
  history). When a feature is removed, mark it `Status: removed`.
- This directory is fork-owned and top-level, so it never conflicts with
  upstream merges.

## Relationship to the maintenance ledger

The `paseo-local-maintenance` skill keeps a customization ledger
(`references/customizations.md`) focused on *surviving upstream merges*:
owning files, regression tests, conflict hotspots, focused validation
commands. These docs are the complementary *why and how* narrative. Keep both
updated; the ledger stays authoritative for merge mechanics, this directory
stays authoritative for intent and design.

## Index

| Doc | Feature |
| --- | --- |
| [terminal-color-isolation.md](terminal-color-isolation.md) | Daemon terminals advertise truecolor and ignore daemon-level color suppression |
| [latex-markdown-rendering.md](latex-markdown-rendering.md) | KaTeX MathML rendering for LaTeX in chat Markdown |
| [safe-local-macos-app-replacement.md](safe-local-macos-app-replacement.md) | Installer that replaces the running Mac app safely with rollback |
| [stable-local-macos-signing.md](stable-local-macos-signing.md) | Reusable `Paseo Local` signing identity so TCC grants survive rebuilds |
| [intermediate-process-folding.md](intermediate-process-folding.md) | Fold reasoning/tool calls/todos into one collapsible group per turn |
| [compact-codex-assistant-boundaries.md](compact-codex-assistant-boundaries.md) | Compact visible divider between Codex assistant messages |
| [persistent-terminal-sessions.md](persistent-terminal-sessions.md) | PTYs owned by a detached worker survive daemon restarts |
| [viewport-only-terminal-restore.md](viewport-only-terminal-restore.md) | Reopening a terminal paints the viewport, not replayed scrollback |
| [agent-tui-conversation-switch.md](agent-tui-conversation-switch.md) | Switch an agent conversation between Agent view and its real TUI |
| [agent-side-chat.md](agent-side-chat.md) | Side-question overlay on live Claude agents (SDK `/btw`) |
| [codex-terminal-image-paste.md](codex-terminal-image-paste.md) | Paste clipboard images into Codex conversation terminals |
| [ink-tui-caret-visibility.md](ink-tui-caret-visibility.md) | Visible caret for Ink TUIs on the WebGL renderer |
| [kitty-graphics-ack.md](kitty-graphics-ack.md) | Kitty graphics ACKs answered on stdin, never typed at the prompt |
| [chrome-link-opener.md](chrome-link-opener.md) | Host-window links open in Google Chrome |
| [codex-appearance-theme.md](codex-appearance-theme.md) | Codex charcoal appearance theme |
