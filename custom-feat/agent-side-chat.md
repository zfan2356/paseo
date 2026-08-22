# Agent side chat (Claude side questions)

- Status: active
- Commits: `85ccc4615`
- Ledger entry: "Agent side chat (Claude side questions)"

## Original requirement

While a Claude agent is deep in a long turn, the user often wants to ask a
quick clarifying question — "what did that error mean?", "which file was
that?" — without interrupting the foreground work or polluting the
conversation timeline. Claude Code's CLI has `/btw` for exactly this. The
requirement: bring that capability to the Paseo Agent view as a lightweight
side chat.

## Design

- Transport: the Claude Agent SDK `side_question` control request (the CLI
  `/btw` machinery) on the agent's **existing SDK query**. Answers run one
  model turn grounded in the live conversation context, cannot use tools,
  and never touch the Paseo timeline or persisted state.
- Protocol: RPC pair `agent.side_question.ask.request` /
  `agent.side_question.ask.response` (`agentId`, `question`, `requestId`;
  payload `response: string | null`, optional `synthetic`,
  `error: string | null`), 3-minute client timeout. Mixed versions fail
  closed behind the `agentSideQuestion` server feature.
- UI: a small overlay panel on the Agent view (`packages/app/src/side-chat/`)
  toggled from the workspace header next to the Agent/TUI switch. Shown only
  for provider `claude` when the feature is on; other providers are rejected
  server-side.
- SDK 0.3.220 implements `askSideQuestion` at runtime but omits it from the
  published `Query` typings, so the provider calls it behind a runtime check
  and reports a clear error on an older CLI. When the SDK gains typed
  support (and a `history` option), drop the cast and consider forwarding
  client history.
- Exchange history is client-side and in-memory only (like TUI `/btw`); it
  clears on app reload.

### Limitations

- Claude-only; Codex/Cursor have no equivalent channel.
- No cross-question memory — each question is independent, though grounded
  in the main conversation.
- Validated with unit tests and static checks; not yet exercised against a
  live daemon or on native mobile.
