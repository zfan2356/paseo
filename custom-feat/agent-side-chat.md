# Agent side chat

- Status: active
- Original commit: `85ccc4615` (one-shot Claude side questions)
- Full-conversation fork: 2026-08-24
- Durable history: 2026-09-10
- Ledger entry: "Agent side chat (side questions)"

## Original requirement

While an agent is deep in a long turn, the user can branch from its current
conversation without interrupting the main conversation. Side Chat reuses the
normal messages, reasoning, tool calls, permissions, Composer, and subagent UI.
The native fork carries the parent context, but the visible transcript starts
blank and contains only turns created inside that side conversation.

The original disposable behavior lost conversations on close, disconnect, and
refresh. The revised contract is:

- Clicking Side Chat first displays a history list scoped to the parent agent.
- Entries show the first question as title, update time, and stable conversation ID.
- Only **New conversation** forks Main Chat's current state, including an active turn.
- Selecting history resumes the same agent ID and native provider session.
- Closing hides the view. It does not destroy history or interrupt in-flight work.
- Refreshing displays history again, never automatically creating a conversation.
- Transient reconnects reattach the selected conversation by its original ID.
- Main Chat and each Side Chat advance independently; reopening is not re-forking.

## Design

The fork-owned modules live in `packages/app/src/side-chat/`. Both desktop and
compact layouts share `SideChatContent` and the `useFetchQuery`-backed
`SideChatHistory`. They render the normal `AgentPanelContent` for the selected
internal agent rather than maintaining another chat renderer. Nested Side Chats
are disabled. A Back to history action allows switching between saved conversations.

Desktop docks a `side_chat` tab in the right-side workspace pane through
`openWorkspaceTargetBeside`. The header always reveals history; the tab close
button only closes the view. Compact layouts retain their overlay.

### Entry point gating

The header entry point follows the capability, not the provider name. `toAgentPayload`
projects `capabilities.sideChatFork` from the live session's `forkForSideChat` hook, and
`canOfferSideChat` shows the entry only when that flag is true. The capability object
already carries `.catchall(z.boolean())` on the wire, so the extra flag needs no protocol
change and older clients ignore it. Sessions without a native fork therefore show no entry
point, and a provider that gains `session/fork` later needs no client change.

### Persistence and transport

Side conversations reuse AgentStorage and the durable timeline store. Internal
agents labeled `paseo.sideChat.parentAgentId` are persisted; other temporary
internal agents remain ephemeral. No parallel catalog or storage schema is added.
The label is attached only after a native fork is successfully realized. Pending
source handles must never be stored as resumable side conversations.

Both creation and resume mark provider history as primed. Inherited parent turns
stay hidden; the durable timeline supplies the side conversation's own turns.
Side agents remain excluded from the ordinary directory. Clients attach by exact
ID through the side chat RPC and then use regular agent RPCs. Snapshots use
`agent.side_chat.agent_state`; timeline, permissions, and subagent events retain
their existing shapes. Timeline snapshots update side-agent details without
promoting them into the public directory or auto-opening ordinary agent tabs.
View closure preserves local transcripts and drafts so the timeline owner's
cached cursor is never left pointing at deleted local rows. Explicit parent
deletion still uses `AgentStoreProjection.remove` for replica cleanup.

The existing `agent.side_question.ask.request` / response pair remains compatible:

- `operation: "list"` returns saved side conversations without starting a runtime.
- `operation: "open"` with `sideAgentId` attaches or resumes that exact conversation.
- `operation: "open"` without `sideAgentId` explicitly creates a new fork.
- `operation: "close"` detaches that client's subscription only.
- Omitting operation retains the old one-shot `askSideQuestion` behavior.

The new UI requires `agentSideChatHistory`; it must not fall back to an older
daemon's destructive lifecycle. These requests require `workspace.write`, while
side-agent state events require `workspace.read` in the existing permission map.

### Provider forks

Codex uses `thread/fork` with full history (`excludeTurns: false`). Fork creation
happens inside the side agent's own app-server process using
`sideChatForkFromThreadId`, avoiding the native cross-process thread writer lock.
`forkForSideChat` initially returns `sideChatForkPending`; after connect, the
realized native ID replaces it in the live agent and persisted record.

Claude uses the Agent SDK `forkSession` and resumes the returned session.
ACP agents use the experimental `session/fork` call: the fork is created inside
the live agent and the returned session id is resumed through `session/load` or
`session/resume`. `ACPAgentSession` installs `forkForSideChat` and
`disposeSideChatFork` only when the initialize response advertises
`sessionCapabilities.fork`, so agents without the capability still hit the shared
guard. Disposal needs `sessionCapabilities.close` and is a no-op without it.
An ACP agent must therefore also support resume for the forked id, which is what
the resumed side-chat agent uses in its own process.
Both providers retain their native session across view closure. Native archival
or deletion is used only to clean up an incomplete creation, not a saved chat.
The old one-shot transports remain for protocol compatibility.

### Lifecycle

Client generations prevent late open responses from replacing newer selections.
Late responses for the same selected ID must not detach its current subscription.
Failed resumes retain that ID; retries never create a replacement implicitly.

The server verifies ownership before and after event subscription and buffers
replay events until verification succeeds. Repeated attaches replace old
subscriptions. Client disconnect unsubscribes without closing side runtimes.
Closing the parent runtime preserves existing side conversations. A parent close
during a new fork waits for the in-flight creation and discards incomplete forks.

Daemon restart resumes saved conversations on demand, even with a closed parent
runtime. Concurrent resumes use the existing per-agent lifecycle queue. Closing
an internal runtime preserves the storage record and committed timeline.

`openSideChat` for a stored conversation already holds that side agent's
lifecycle lane, so the resume inside it calls the unqueued internal resume.
Calling the public resume would queue behind the lane it is already running in
and never settle. For the same reason, replica cleanup runs through
`AgentStoreProjection.removeFromDirectory` when a side agent leaves the active
directory: it clears directory-owned state (focus, tasks, submissions, explorer)
while leaving the transcript, its cursor, and its pagination metadata alone.
Only entity deletion destroys a transcript.

Side chats are not independent conversations. Archive and restore are refused
unless the parent conversation is performing that same transition. Closing a
leaked directory tab is layout-only. Parent archive always cascades to every
labeled side chat and never detaches one because a tab is open. Parent restore
restores those side chats with it. Identity follows `paseo.sideChat.parentAgentId`
even if a resume dropped `internal`; persistence writes the flag back. Opening a
side chat whose parent is still live also clears a leftover independent archive.

Side-chat `agent_stream` events use the same viewed-timeline owned subscription
as Main Chat. Broadcasting them from the Side Chat subscriber leaves 0.8.0
clients with a hung overlay: the local prompt is visible, the daemon has
replied, and the stop control stays armed.

## Limitations

- Claude and Codex expose provider-native conversation forks, and so does any ACP
  agent that advertises `session/fork`. ACP agents without the capability keep the
  shared "Provider does not support forked side chats" error and show no entry point.
  Reaching one requires both `session/fork` and a resume path for the returned id
  (`loadSession` or `session/resume`). `cursor-agent` 2026.08.31-4057e58 advertises
  `loadSession` and `sessionCapabilities.list` only, so Cursor conversations stay
  unsupported until the binary advertises fork.
- Side Chat does not follow later Main Chat turns; choose New conversation for
  updated Main Chat context.
- Conversations already destroyed by older versions cannot be recovered by this fix.
- History requires the new daemon and frontend; source publication alone is not deployment.
- Native mobile behavior has not been exercised locally.

## Focused validation

```bash
npx vitest run packages/server/src/server/agent/agent-manager.test.ts packages/server/src/server/agent/provider-registry-wrap.test.ts --bail=1
npx vitest run packages/server/src/server/session.test.ts -t "side chat" --bail=1
cd packages/app
npx vitest run --project=unit src/side-chat/model.test.ts src/side-chat/lifecycle.test.ts src/subagents/close-tab-policy.test.ts src/i18n/resources.test.ts
npx playwright test e2e/browser/side-chat-history.real.spec.ts --project=real-provider
```

Use test-only Node 22+ for the browser harness. Real-provider credentials belong
in a private E2E home outside the repository, never in fixtures or committed config.
The browser regression covers history-first entry, selection, close/reopen,
refresh, continued native context, and explicit-only creation of another chat.
