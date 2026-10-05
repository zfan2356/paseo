# Internal agent messages

- Status: active
- Ledger entry: "Agent-to-agent messages stay out of user chat"

## Original requirement

A scheduled observer sent a detailed heartbeat report to an existing agent.
Paseo displayed the report as if the human had typed it. Schedule fires and
finish notifications already stayed out of the visible user transcript, but
direct messages between agents did not.

## Design

- The caller-scoped `send_agent_prompt` tool wraps messages to another agent
  in the existing `<paseo-system>` envelope and identifies the sending agent.
- The receiving provider retains the message as context. Existing daemon
  timeline filtering excludes it during live delivery and history replay;
  no client update or new protocol field is needed.
- Top-level requests and messages an agent sends to itself keep their original
  text, including slash commands. Existing envelopes are not nested.
- This only controls the input message's visibility. Assistant replies remain
  visible, and native provider transcripts retain the injected context.
