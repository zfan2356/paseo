# Compact Codex assistant boundaries

- Status: removed (2026-11-03, at the user's request)
- Commits: `99b8d2fc5`, `d90deaf50`
- Ledger entry: "Compact Codex assistant boundaries"

## Original requirement

Codex emits several assistant items within one turn. The original separator
between them rendered as a large blank paragraph gap, wasting vertical space
and making one turn look like several unrelated messages. The requirement: a
visible but compact divider between consecutive Codex assistant messages,
also for already-persisted history.

## Removal

Codex assistant boundaries and Markdown rule styling now follow upstream:
`\n\n---\n\n`, the theme's `border` color and normal block spacing. Upstream
still emits Markdown dividers; this removal does not disable that behavior.

The fork's compact boundary helper, history normalization, special rule styling
and compact-rendering regression were removed. Side-question answers no longer
strip a model-authored `---\n` prefix. Existing stored messages are not rewritten.

[Intermediate process folding](intermediate-process-folding.md) remains active.
This document is retained only as historical context, not a merge invariant.
