# Switch Agent conversations between Agent and TUI

- Status: active
- Commits: `98d675b8e`, `027286591`, `a15b67502`, `b417f2e09`, `caedcd366`, `5d9cfec7a`
- Ledger entry: "Switch Agent conversations between Agent and TUI"

## Original requirement

Paseo's Agent view and the provider's own TUI (Codex / Claude Code / Cursor
in a terminal) each do things the other cannot. The requirement: a header
button on a live agent tab that flips the _same conversation_ between the
Agent chat view and the provider's **real TUI**, resuming the same native
session — and flips back — without losing history on either side.

Explicitly rejected early: restyling the Agent chat to look like a TUI. The
TUI view must be a real linked PTY running the provider CLI.

## Design

- **To TUI**: the header switch calls `createTerminal({ agentId })` (or
  reuses an existing linked conversation PTY) and retargets the same tab to
  `{ kind: "terminal", terminalId }` via `replaceTabId`. The PTY launches
  the provider CLI resuming `persistence.sessionId`, inheriting the
  provider's configured command prefix and env (custom wrappers,
  `CODEX_HOME`, …) so it resolves the same native session as the Agent
  runtime — independent of the detached worker's older environment.
- **Back to Agent**: `switchAgentTerminalToAgent` (legacy Codex RPC still
  supported) stops the PTY, resumes the Agent runtime with provider history
  rehydrated (`reconcileProviderHistory`; an empty TUI resume history must
  not wipe a non-empty timeline), then retargets the tab to
  `{ kind: "agent", agentId }`. If the switch RPC fails the PTY is killed; a
  successful switch or kill is not undone by a later `fetchTimeline`
  failure.
- **Write exclusivity**: while a conversation PTY exists, the Agent composer
  is blocked (`isSubmitLoading` from the surface store) for that agent and
  for an agent whose release is in flight — one writer at a time.
- **Gating**: the button appears only for unarchived agents of providers
  `codex` / `claude` / `cursor` with a `persistence.sessionId`, behind the
  `agentConversationViewSwitch` feature (legacy `codexConversationViewSwitch`
  enables Codex only). Creating or leaving the TUI needs a live host and
  workspace directory. Legacy clients that kill a linked PTY get the kill
  ack only after the Agent runtime has resumed.
- The client-side surface lives in `packages/app/src/conversation-surface/`;
  the server side spans agent-manager, session dispatch, and
  `codex-fork-terminal.ts` / `terminal-session-controller.ts`.

Depends on [persistent-terminal-sessions.md](persistent-terminal-sessions.md)
for the PTY substrate. Do not auto-kill a linked conversation PTY just
because an Agent tab gains focus — that PTY _is_ the TUI view.
