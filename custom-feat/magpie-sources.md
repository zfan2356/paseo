# Magpie account and API sources

Status: active

## Original requirement

The CVM already has Cursor and Codex subscriptions plus iChat and DeepSeek API
credentials. Paseo must display and use all sources rather than showing only
Codex/Claude login cards or reading a legacy Codex account directory.

## Design

`plugins/magpie/server/projection.ts` projects the provider list into display-only
IDs, names, readiness, account summaries and exposed-model counts. The account
surface shows all providers; interactive sign-in remains limited to supported
Codex and Claude flows. Readiness counts include every provider. Quota failures
remain distinct from source configuration and never imply a fallback route exists.

`skills/deploy-magpie/scripts/magpie-start.py` accepts a private host-local
`~/.config/magpie/runtime.json` with an absolute existing `codexHome`. This overrides
CODEX_HOME only for Magpie; subscription credentials stay in their original home.
API credentials are registered in Magpie's private store, never in this repository.
No default agent routing is changed by this UI or startup configuration.

## Validation

The Magpie projection test verifies model counts, older responses without counts,
and removal of credential fields. A browser regression renders all four sources
and model counts without unsupported login actions or invented fallback routes. Starter tests verify process-local home selection
and rejection of invalid paths or unrelated settings. Reload the installed plugin
on each host and test actual provider calls separately from readiness and quota.
