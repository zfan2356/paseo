# Codex appearance theme

- Status: active
- Commits: `67a6ffc78`
- Ledger entry: "Codex appearance theme"

## Original requirement

The user works in ChatGPT/Codex surfaces a lot and wanted Paseo to offer the
same charcoal look as a first-class theme choice, alongside the existing
Claude-flavored option.

## Design

- A `codex` variant is added to `THEME_OPTIONS` in
  `packages/app/src/styles/theme.ts`, listed after Claude in Settings →
  Appearance → Theme, with locale labels in all i18n resources.
- Surface palette: chat `#212121`, sidebar `#171717`, selected/elevated
  `#2f2f2f`, muted text `#9b9b9b`, accent `#52a06f`.
- Selection persists through the existing `THEME_OPTIONS` settings schema —
  no new persistence. Other themes and adaptive/system mode are unchanged.
- After the 2026-08-20 upstream merge, dark-theme hover/selection follow
  upstream `surface1` / `surface2` derivation; the selected/elevated surface
  remains pinned at `#2f2f2f`.
