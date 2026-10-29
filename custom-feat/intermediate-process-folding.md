# Intermediate process folding

- Status: active
- Commits: `b1fabae62`, `99b8d2fc5`, `d90deaf50`, `1f1ebca37`
- Ledger entry: "Intermediate process folding"

## Original requirement

A long agent turn fills the chat with reasoning blocks, tool calls, and todo
updates; the final answer drowns in scrollback and skimming a finished
conversation means paging through machinery. The requirement: while a turn is
running show the live process, but once it finishes, collapse everything
before the final answer into one compact expandable group — like Claude
Code's own transcript folding — on both desktop and mobile.

## Design

A **render-only projection** over the agent stream — canonical timeline data,
fork context, pagination, and tool-call detail data are untouched:

- Upstream `agent-stream/turn-collapse/model.ts` owns the grouping and
  `turn-collapse/summary-line.tsx` owns the summary. Its process policy groups
  everything between the user message and the turn's final assistant answer:
  progress messages, reasoning, tool calls, todo lists.
- Phase-scoped expansion: a live group is expanded by default; an explicit
  user toggle is honored only while the group stays in its current phase.
  Completion drops the live override and collapses the group; the user can
  re-expand it afterwards.
- Failed tool calls keep the group's error presentation but cannot force a
  completed group open; `autoExpandReasoning` governs thought content inside
  an expanded group only.
- A context-compaction marker stays inside its surrounding group at its
  chronological position instead of splitting the turn into duplicate
  groups.
- The final assistant answer always stays outside the group and visible.
- Shared by the desktop web and native/mobile stream renderers.

Upstream plugin timeline transforms run before intermediate-process folding;
the folded result feeds the history window and render layout. Plugin-owned
timeline items therefore keep their transforms instead of bypassing them.

Collapse process is an explicit chat display mode and the fork default. Full
now means unfolded chat. The old Full/Detailed choice migrates once to process
folding; a later explicit Full choice survives reloads and unrelated saves.
The upstream engine owns canonical turn boundaries, search-to-host mapping,
reading-position replacements and virtualized rows in every collapse mode.
Opening a process exposes ordinary rows rather than a second nested list.
An automatic new turn cannot swallow the preceding turn's final answer.

The projection sits on top of stream virtualization, so item identity and
tail/live-head boundary handling in `agent-stream/view.tsx` are the sensitive
merge seams (see the ledger for hotspots and focused tests).
