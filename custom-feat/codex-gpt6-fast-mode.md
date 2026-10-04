# Codex GPT-6 Fast mode

- Status: upstream catalog speeds with an active iChat compatibility overlay
- Ledger entry: "Codex GPT-6 Fast mode support"

## Original requirement

GPT-6 Sol and later GPT-6.1 Sol appeared in Paseo's Codex model picker, but the Fast control was
absent. Listing a model in `agents.providers.codex.models` did not update the
server's separate Fast capability allowlist.

## Design

- Upstream now owns the `service_tier` selector and discovers Fast and Ultrafast from
  the Codex model catalog. Its existing migration preserves saved `fast_mode` preferences.
- The iChat catalog currently advertises no speed tiers. The fork-owned
  `codex/ichat-service-tiers.ts` preserves Fast for the previously supported models,
  only when the session environment identifies the maintained iChat wrapper through
  `ICHAT_PROXY_PY`. Unknown models and ordinary Codex sessions get no inferred capability.
- Advertised tiers always take precedence. The compatibility tier sends `serviceTier: "fast"`;
  it never invents Ultrafast or changes the model catalog, proxy, or live configuration.
- Agent/TUI switching carries the live `service_tier` value into the root CLI config,
  falling back to saved settings and then the legacy Fast preference for older sessions.
- Provider and terminal-launch tests cover preference migration, advertised-tier precedence,
  unsupported models, and Normal/Fast/Ultrafast handoff.
- Fast request forwarding does not itself establish that the iChat proxy or
  upstream account provides faster inference; verify that separately.
