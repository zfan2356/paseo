# Internal agent messages

- Status: active
- Ledger entry: "Agent-to-agent messages stay out of user chat"

## Original requirement

A scheduled observer sent a detailed heartbeat report to an existing agent,
and Paseo displayed it as if the human had typed it. After upstream added sender
attribution, the user still found orchestration conversations too crowded:
long reports, finish notifications and the main agent's answers competed in chat.
On November 6, 2026 the user requested compact, expandable reports and a combined
presentation for an adjacent report and completion notification.

## Design

- Upstream owns delivery, authenticated provenance and provider history.
  The client groups received reports after plugin transforms, without changing
  canonical rows, prompts, notifications or stored context.
- Reports use the existing expandable badge and per-agent expansion store.
  They start closed in every chat display mode, retain sender navigation and
  copying, and render Markdown when opened. Main-agent answers stay visible.
- Adjacent messages and a following successful completion from the same sender,
  host and identified turn share one report. Human input, intervening activity,
  another sender or host, and turn boundaries prevent merging. Legacy rows
  without turn IDs stay separate. Errors, cancellations and permission requests
  remain separate events.
- Every grouped entry retains its source ID and exact text. Search opens the
  containing report, counts each entry only once and can navigate to a folded
  entry. Reading anchors map removed rows to their report host. Reload rebuilds
  the same groups from canonical history.
- The fork module is `packages/app/src/agent-stream/agent-reports/`. Its seams
  are stream presentation, user-row rendering, search ownership and a client-only
  field on `UserMessageItem`. The existing server search also indexes report and
  completion text, retaining individual source locations. No protocol fields,
  delivery behavior or stored records change.

## October 23 upstream integration

Upstream absorbed structured provenance and batched delivery on October 23.
Its October 27 presentation subsequently restored received-message bubbles with
sender labels. The November 6 client overlay replaces those bubbles with reports;
it keeps the upstream delivery model. Self-directed goal commands retain their
separate out-of-band path. The old manually prepended sender envelope is not used.
