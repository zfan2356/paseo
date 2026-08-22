# Compact Codex assistant boundaries

- Status: active
- Commits: `99b8d2fc5`, `d90deaf50`
- Ledger entry: "Compact Codex assistant boundaries"

## Original requirement

Codex emits several assistant items within one turn. The original separator
between them rendered as a large blank paragraph gap, wasting vertical space
and making one turn look like several unrelated messages. The requirement: a
visible but compact divider between consecutive Codex assistant messages,
also for already-persisted history.

## Design

- New boundaries are emitted as `---\n` — a Markdown horizontal rule with no
  surrounding blank paragraphs (`assistant-message-boundary.ts`, applied in
  `codex-app-server-agent.ts`).
- Persisted messages that begin with the legacy `\n\n---\n\n` boundary are
  normalized to the compact form **at read time** during canonical and
  projected timeline reads (`timeline-projection.ts`) — no storage
  migration, and unrelated message content is never rewritten.
- The rendered rule is styled deliberately (`markdown-styles.ts`):
  `foregroundExtraMuted`, one-pixel height, eight-pixel vertical margins, so
  it stays visible on the Pure Black theme without recreating the old gap.

Interacts with [intermediate-process-folding.md](intermediate-process-folding.md):
the divider is part of assistant content and must stay compact inside and
outside folded groups.
