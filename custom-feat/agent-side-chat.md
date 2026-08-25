# Agent side chat

- Status: active
- Original commit: `85ccc4615` (one-shot Claude side questions)
- Full-conversation fork: 2026-08-24
- Ledger entry: "Agent side chat (side questions)"

## Original requirement

While an agent is deep in a long turn, the user often wants to branch from the
current conversation without interrupting or changing the main conversation.
The Side Chat should feel like Main Chat: the fork carries the full parent
conversation as model context, but the visible transcript starts blank and
only shows turns created inside the Side Chat. It supports normal messages,
reasoning, tool calls, permissions, Composer, and provider subagents.

The branch semantics are deliberate:

- Opening Side Chat forks the provider's current conversation state, including
  a Main Chat turn that is still running. This lets the user ask about current
  progress without interrupting the Main Chat.
- Main Chat and Side Chat advance independently after the fork. Side Chat does
  not follow later Main Chat messages while it remains open.
- Closing Side Chat destroys that provider fork and its local replica.
- Opening it again creates a new fork from Main Chat's then-current state.

## Design

The Agent view owns a small overlay panel in `packages/app/src/side-chat/`.
Instead of implementing a second chat renderer, the panel renders the normal
`AgentPanelContent` for an internal agent. This reuses the same timeline,
reasoning, tools, permission prompts, Composer, and subagent UI as Main Chat.
Nested Side Chats are disabled.

The open flow marks the internal agent's history as primed instead of
hydrating provider history, so the inherited turns stay out of the timeline
and the transcript starts blank; the provider fork still holds the full
conversation as context. For Codex the fork itself is created inside the side
agent's own app-server process (`sideChatForkFromThreadId` on resume): codex
keeps a cross-process writer lock per loaded thread, so a fork created by the
parent's process could never be resumed by the side agent. `forkForSideChat`
returns a pending handle (`sideChatForkPending`) whose realized thread id is
read back from the side session after connect; disposing a pending handle is
a no-op so a failed open can never archive the parent thread.

The internal side agent is excluded from the normal agent directory. The
client session that opened it may address it by exact ID through the regular
agent RPCs. Its state is delivered through
`agent.side_chat.agent_state`; ordinary stream, timeline, permission, and
provider-subagent events keep their existing shapes.

The existing `agent.side_question.ask.request` /
`agent.side_question.ask.response` RPC pair remains backward compatible. New
clients set `operation: "open" | "close"` and use `sideAgentId`; an omitted
operation still invokes the old one-shot `askSideQuestion` behavior. Mixed
versions fail closed through the separate `agentSideChatFork` feature flag.

### Provider forks

- Codex calls `thread/fork` with full history (`excludeTurns: false`), resumes
  the returned thread as an internal agent, and archives it when Side Chat
  closes.
- Claude calls the Agent SDK `forkSession`, resumes the returned session as an
  internal agent, and deletes it with `deleteSession` on close.

Both provider forks keep their normal tools and permission handling. The old
one-shot transports remain only for protocol compatibility.

### Lifecycle

Opening hydrates the fork's provider history before the panel becomes ready.
The client uses generations so closing or reopening during an in-flight open
cannot publish an obsolete fork. The server also verifies ownership before
and after subscription, buffers replay events until that verification passes,
and coordinates parent close with in-flight Side Chat opens.

Closing the parent closes all owned Side Chats first. Provider disposal
failures leave ownership retryable and prevent the parent from being closed
prematurely. Client disconnect clears Side Chat panels, internal agent
replicas, pending permissions, timeline state, drafts, and provider subagents;
the server session disposes its corresponding forks.

## Limitations

- Only Claude and Codex expose provider-native conversation forks.
- An open Side Chat is a branch, not a live mirror. Later Main Chat messages
  are visible only after closing it and opening a new Side Chat.
- Side Chat state is ephemeral and is discarded on close, disconnect, or app
  reload.
- Native mobile behavior has not been exercised locally.

## Focused validation

```bash
npx vitest run packages/app/src/side-chat/model.test.ts packages/app/src/side-chat/lifecycle.test.ts packages/app/src/utils/agent-directory-sync.test.ts packages/server/src/server/agent/agent-manager.test.ts packages/server/src/server/agent/provider-registry-wrap.test.ts --bail=1
npx vitest run packages/server/src/server/session.test.ts -t "side chat open does not publish" --bail=1
```
