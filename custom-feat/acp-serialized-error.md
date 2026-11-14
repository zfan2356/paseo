# ACP serialized provider errors

Status: active

## Original requirement

A Cursor conversation stopped mid-work with an `[resource_exhausted]` error and
the user retried it. The retry failed again with the same error, and the error
appeared in the transcript as if the assistant had written it. The conversation
reportedly could not be continued.

Two separate defects were behind that:

1. Cursor CLI reports a failed turn as ordinary assistant text — one line,
   `Error: RetriableError: [resource_exhausted] Error` — and still answers
   `session/prompt` with `stopReason: "end_turn"`. Paseo renders assistant text
   verbatim, so the failure was stored as the assistant's answer and the turn
   was recorded as completed.
2. Because the turn completed, nothing retried. Cursor's own retry loop is off
   in ACP mode, so the only retry was a manual one — which replayed the same
   failing request and produced the same line.

## Design

- `acp-serialized-error.ts` owns the recognition. It matches only a whole
  assistant message that is one short single line with a known error kind
  (`RetriableError`, `NonRetriableError`, `ActionRequiredError`,
  `CancelledError`), an optional bracketed code, and a short trailing message.
  Prose that mentions an error, multi-line output, and unknown kinds stay
  ordinary text, so a real answer is never swallowed.
- `ACPAgentSession` buffers assistant text that could still become such a line
  and decides per chunk: `possible` keeps buffering, `error` records the
  failure, `settled` emits the text. Held text is flushed by the next
  non-assistant update and at the end of the turn, so normal streaming keeps
  its current shape.
- `handlePromptResponse` no longer trusts `end_turn` alone. A recorded
  serialized error turns the response into `turn_failed` carrying the kind and
  code, which the manager renders as a system error and surfaces as agent
  `error` state instead of a silent success.
- A `RetriableError` replays the same prompt up to
  `MAX_SERIALIZED_ERROR_RETRIES` (2) after a one-second delay. The budget resets
  when a turn completes normally, so unrelated later turns get their own
  retries. Non-retriable kinds never replay.
- The retry is deliberately in the ACP session, not the daemon retry loop:
  only this provider needs it, and the prompt is still in scope here.

## Validation

- `acp-serialized-error.test.ts` covers the real line, the prefix/`settled`
  boundaries, and prose that must stay prose.
- `acp-agent.test.ts` "serialized provider error recovery" covers: the error
  never reaching the timeline, a non-retriable failure not replaying, a
  retriable failure replaying the same prompt, and the retry budget stopping
  after 3 total attempts.
- A throwaway probe drove a real `cursor-agent acp` process through
  `ACPAgentSession`: the happy path answered normally, and an injected
  `end_turn` + error line produced `turn_failed` with no rendered error text
  and exactly one automatic replay. The probe was deleted afterwards.

## Known limitations

- A turn that fails _after_ already streaming real prose puts the error line
  inside that message, so the whole message fails the parse and stays prose.
  The turn is then reported as completed. Splitting a message on the error line
  was not attempted because the failure has always arrived as its own message.
- Retrying replays the prompt; a provider that partially applied work before
  failing will see that work twice. Cursor's failures arrive before its
  response is committed, so the observed case is safe.
- The retry delay is fixed, not exponential. Two attempts is enough for the
  transient upstream interruptions this targets; a persistently failing
  conversation should reach the user rather than loop.
