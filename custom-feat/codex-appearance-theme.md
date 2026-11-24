# Codex appearance theme

- Status: active
- Commits: `67a6ffc78`
- Ledger entry: "Codex appearance theme"

## Original requirement

The user works in ChatGPT/Codex surfaces a lot and wanted Paseo to offer the
same charcoal look as a first-class theme choice, alongside the existing
Claude-flavored option.

## Design

- The bundled `codex-theme` plugin contributes the theme through `addTheme`.
  Optional validated semantic overrides preserve the distinct sidebar, border,
  diff, terminal and accent colors. `shared/palette.ts` is the single palette.
- The old `codex` preference resolves to that contribution when available.
  The legacy built-in entry remains an offline/older-host fallback generated
  from the same palette and is hidden in the picker while the plugin is present.
  Selecting the contribution uses the existing `pluginThemeId`; disconnecting
  before its catalog arrives retains the exact Codex fallback.
- Surface palette: chat `#212121`, sidebar `#171717`, selected/elevated
  `#2f2f2f`, muted text `#9b9b9b`, accent `#52a06f`.
- No new persistence schema or settings reset is needed. Older clients keep
  their built-in theme; registration gates once on `themeOverrides` support.
  A regression compares the entire contributed theme with the legacy theme.
- After the 2026-08-20 upstream merge, dark-theme hover/selection follow
  upstream `surface1` / `surface2` derivation; the selected/elevated surface
  remains pinned at `#2f2f2f`.
