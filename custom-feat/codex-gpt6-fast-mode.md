# Codex GPT-6 Fast mode

- Status: active
- Ledger entry: "Codex GPT-6 Fast mode support"

## Original requirement

GPT-6 Sol appeared in Paseo's Codex model picker, but the Fast control was
absent. Listing a model in `agents.providers.codex.models` did not update the
server's separate Fast capability allowlist.

## Design

- Add GPT-6 Sol and GPT-6 Luna to the existing Codex Fast-supported model list,
  matching the documented GPT-6 family alongside GPT-6 Astra. Do not infer
  Fast support for unrelated or unknown model IDs.
- Keep the existing feature flag, preference restore, and `turn/start`
  `serviceTier: "fast"` request path; no new UI, schema, or proxy behavior is added.
- Extend the existing provider test to cover visibility, request parameters,
  and preference restore across supported model switches.
- Fast request forwarding does not itself establish that the iChat proxy or
  upstream account provides faster inference; verify that separately.
