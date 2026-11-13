# Magpie Auto speed tiers

Status: active in source; deployment requires a Magpie restart.

## Original requirement

An `auto/<model>` route with the same model on personal Codex and iChat must
offer every speed either source advertises. A request keeps the configured
source order and affinity, with its speed fitted independently for each try.

## Design

The pinned Magpie patch reads each account's or provider's own model-list tiers.
The paired Auto catalog advertises their union. For a selected source, an
unsupported `ultrafast` request becomes `priority` when that source advertises
it, otherwise Normal; an unsupported `priority` request becomes Normal. A
missing tier list is unknown and takes the conservative Normal path. Other
groups and explicit source routes retain their upstream behavior.

An optional private `tierCatalog` in Magpie's runtime configuration names the
existing curated Codex catalog. Each Magpie catalog sync updates only the
`service_tiers` of paired Auto entries in that file; it never adds or removes
models, renames entries, or changes their other capabilities. This is opt-in
and does not change which file a Codex home reads. Runtime configuration and
the selected `model_catalog_json` must be aligned during the authorized rollout.

The upstream-reported served tier is separate from the requested and transmitted
tier. An accepted request alone does not prove that the backend ran it faster.

## Validation

The patch's focused provider and gateway tests cover union, missing metadata,
per-attempt downgrade and ordered personal-to-iChat fallback, with local fake
upstreams. The catalog test checks preservation and idempotence. The launcher
test checks the opt-in path. Real backend speed and billing are not inferred.
