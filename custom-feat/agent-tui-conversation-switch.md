# Switch Agent conversations between Agent and TUI

- Status: active
- Commits: `98d675b8e`, `027286591`, `a15b67502`, `b417f2e09`, `caedcd366`, `5d9cfec7a`, `88426c959`, `6ef89aec5`
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
  runtime — independent of the detached worker's older environment. Cursor
  Agent's configured command is `cursor-agent acp`; the TUI launch keeps
  the binary and wrapper flags but drops the `acp` transport token so the
  PTY runs the interactive CLI instead of ACP JSON-RPC.
- **Launch configuration**: read the current registry's resolved runtime settings,
  which are also used to create the Agent client. Startup settings alone omit
  provider command/env overrides and become stale after a live config replacement.
  Prepared config replacements stay invisible until committed; committed changes
  and removal also apply to subsequent TUI launches.
- **Codex CLI scope**: generated model, reasoning, service-tier, and permission
  options precede `resume`. Splitting `-c` / `--config` options between the root
  command and subcommand can discard a wrapper's root-level provider configuration
  in Codex, sending the resumed conversation through the default account instead.
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
- **Lifecycle serialization**: the terminal claim already owns the agent's
  lifecycle queue. It closes the runtime directly, rather than re-entering
  the queued public close operation and waiting on itself.
- **Ownership release on exit**: a linked PTY that exits on its own releases the
  Agent claim through the stream's `terminal.onExit` hook. The terminal carries
  `linkedAgentId`, and the conversation terminal name parses back to one, so the
  hook needs no separate exit-subscription registry. An exit caused by an
  explicit kill or switch is skipped: those operations resume the Agent
  themselves and must not race a second release.
- **Loader ordering**: `ensureAgentLoaded` awaits the close barrier before it
  joins an in-flight load, and its runtime-availability guard sits on the resume
  path only. Joining earlier let a protected caller adopt a resume that a queued
  archive then invalidated; guarding before the join deferred the broadcast
  upgrade that a second caller contributes.
- **Authorization**: conversation handoff requires `workspace.write`, including
  the legacy Codex switch RPC. Read-only clients cannot transfer the writer.
- **Gating**: the button appears only for unarchived agents of providers
  `codex` / `claude` / `cursor` / `antigravity` with a `persistence.sessionId`, behind the
  `agentConversationViewSwitch` feature (legacy `codexConversationViewSwitch`
  enables Codex only). Creating or leaving the TUI needs a live host and
  workspace directory. Legacy clients that kill a linked PTY get the kill
  ack only after the Agent runtime has resumed.
- The client-side surface lives in `packages/app/src/conversation-surface/`;
  the server side spans agent-manager, session dispatch, and
  `codex-fork-terminal.ts` / `terminal-session-controller.ts`.

Antigravity is also supported through its maintained ACP/CLI wrapper. Its
shared-database contract and version pins are documented in
[antigravity-conversations.md](antigravity-conversations.md).

Depends on [persistent-terminal-sessions.md](persistent-terminal-sessions.md)
for the PTY substrate. Do not auto-kill a linked conversation PTY just
because an Agent tab gains focus — that PTY _is_ the TUI view.
