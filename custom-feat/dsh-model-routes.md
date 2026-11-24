# DSH model sources

Status: active

## Original requirement

Expose Official, Unified and iChat choices for DSH, following the explicit
source choices used for Codex. A model switch must change the request route,
and the displayed model must describe the route actually in use.

## Design

The DSH ACP bridge owns a six-entry menu: Flash and Pro each provide Official,
Unified and iChat. All requests enter the host's Magpie gateway. Official pins
the DeepSeek provider; iChat pins the iChat provider. Unified uses a dedicated
group with `routing: order` and `affinity: session`, official first and iChat
second. The default is Flash Unified.

The fork at `zfan2356/dsh-acp-paseo` owns the implementation and its
`paseo/deepseek-routes.json` preset. ACP IDs are distinct from native
provider/model pairs. The old `deepseek-flash` and `deepseek-v4-pro` IDs remain
valid as the Official choices. Forking a session preserves its selected route.

The configuration helper in that repository updates the existing DSH provider
without replacing its launch command, publishes the two groups using Magpie's
local management API, and backs up the Paseo config. DSH's installation seed
and live profile must use the same published bridge. Configuration reload and
provider-catalog refresh activate the menu without a Paseo daemon restart.

## Validation

The bridge's `test-model-routes.mjs` verifies menu-to-route mapping and ordered
group policy. `test-acp-model-routes.mjs` starts the real DSH runtime in an
isolated home, selects each of the six entries, and checks the model received by
a local fake gateway. It also checks that a fork retains the selected source.
Existing replay and image-normalization regressions remain applicable.

The initial bridge implementation is published as `0d372bb` in
`zfan2356/dsh-acp-paseo`.
