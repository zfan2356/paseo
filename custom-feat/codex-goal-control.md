# Codex goal control

Status: implemented; daemon deployment requires separate approval.

## Original requirement

After the user asked Codex to stop monitoring, its goal kept waking the
conversation. Codex could not pause through its native `update_goal` tool and
repeatedly directed the user to a Goal button that Paseo did not provide.

## Design

Paseo already accepts `/goal pause`, `/goal resume`, and `/goal clear` outside
the active turn. Goal-enabled Codex sessions now receive instructions for
using that existing path through a self-directed `send_agent_prompt`. The tool
description supplies the caller's Paseo agent ID, distinct from the native
Codex thread ID. New threads, resumed threads, turn overrides, and collaboration
modes receive the same guidance; sessions without goals do not.

Control remains user-directed. A pause request does not authorize resuming,
clearing, marking incomplete work complete, or stopping a remote workload.
An automatic wake never authorizes resumption. Without Paseo tools, the fallback
is a literal `/goal pause` message, not an assumed UI button.

Out-of-band tool replies acknowledge dispatch without waiting for the active
turn or registering a finish notification. Waiting on a self-directed command
can otherwise wait for the very turn blocked on that tool; a self-notification
can create another unwanted wake. Dispatch is not the command outcome: the
response tells Codex to verify with native `get_goal`, while the existing command
path publishes its acknowledgement or error to the conversation. If verification
does not settle, Codex must report uncertainty rather than success.

The overlay lives in `providers/codex/goal-control.ts`, with call sites in the
Codex provider and existing Paseo tool catalog. No new RPC, persisted state,
frontend control, or natural-language keyword interception is added.

## Verification

`codex-app-server-agent.test.ts` covers guidance at thread creation/resume and
turn start, feature-disabled sessions, and pause success/error without interrupt.
`mcp-server.test.ts` covers caller identity, user-consent guidance, self-directed
out-of-band replies in foreground/background mode, and absence of finish
subscriptions. These deterministic tests do not guarantee that every model
will follow the instructions; they verify the integration contract.
