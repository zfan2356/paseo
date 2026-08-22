# Agent side chat (side questions)

- Status: active
- Commits: `85ccc4615` (Claude), Codex support added 2026-08-22
- Ledger entry: "Agent side chat (side questions)"

## Original requirement

While an agent is deep in a long turn, the user often wants to ask a quick
clarifying question — "what did that error mean?", "which file was that?" —
without interrupting the foreground work or polluting the conversation
timeline. Claude Code's CLI has `/btw` for exactly this. The requirement:
bring that capability to the Paseo Agent view as a lightweight side chat.
Codex support was a follow-up requirement: Codex has no `/btw`, but its
thread-fork primitive supports the same user experience.

## Design

- UI: a small overlay panel on the Agent view (`packages/app/src/side-chat/`)
  toggled from the workspace header next to the Agent/TUI switch. Shown for
  providers `claude` and `codex` when the `agentSideQuestion` server feature
  is on; other providers are rejected server-side. Mixed versions fail
  closed.
- Protocol: RPC pair `agent.side_question.ask.request` /
  `agent.side_question.ask.response` (`agentId`, `question`, `requestId`;
  payload `response: string | null`, optional `synthetic`,
  `error: string | null`), 3-minute client timeout. The transport is
  provider-agnostic: `AgentSession.askSideQuestion` behind the
  `supportsSideQuestion` capability flag.
- Answers never touch the Paseo timeline or persisted state, run without
  tools, and exchange history is client-side and in-memory only (clears on
  app reload).

### Claude transport

The Claude Agent SDK `side_question` control request (the CLI `/btw`
machinery) on the agent's **existing SDK query**. Answers run one model turn
grounded in the live conversation context — including the in-flight turn.
SDK 0.3.220 implements `askSideQuestion` at runtime but omits it from the
published `Query` typings, so the provider calls it behind a runtime check
and reports a clear error on an older CLI. When the SDK gains typed support
(and a `history` option), drop the cast and consider forwarding client
history.

### Codex transport

Codex has no side-question channel, so the provider builds one from
`thread/fork` (`packages/server/src/server/agent/providers/codex/side-question.ts`):

- Fork the current thread (`ephemeral: true`, full history) — the fork
  shares the main thread's context without touching it.
- Run one `turn/start` on the forked thread, locked to
  `approvalPolicy: "never"` and a `readOnly` sandbox, with a no-tools
  instruction prepended to the question.
- The agent intercepts all notifications for the forked thread **before**
  timeline and sub-agent routing, so nothing leaks into the main
  conversation; a `CodexSideQuestionRun` collects streamed deltas and
  completed agent-message items (completed item text is authoritative,
  compact `---\n` boundaries are stripped) and resolves on `turn/completed`.
- Server-side timeout is 150 s (inside the client's 3-minute window). The
  forked thread is archived best-effort afterwards for app-servers that
  ignore `ephemeral`.

### Limitations

- Cursor has no equivalent channel.
- No cross-question memory: each question is independent, though grounded in
  the conversation history.
- Codex answers fork from recorded thread history, so work from a
  still-running foreground turn may not be visible to the side answer (the
  Claude transport does see it). Whether the app-server accepts a fork while
  the foreground turn is active has not been exercised against a live
  daemon.
- Validated with unit tests and static checks; not yet exercised against a
  live daemon or on native mobile.
