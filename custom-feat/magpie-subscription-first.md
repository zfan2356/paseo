# Magpie subscription-first routing

Status: removed

The user chose the original routing behavior on 2026-10-25. The quota-only
extension from `927f0e1c0` is removed; retain only the member-window correction
described in [magpie-codex-windows.md](magpie-codex-windows.md). Do not reapply the
historical policy below during upgrades.

## Original requirement

Codex Unified must use the user's subscription while it is available. Only
confirmed subscription quota exhaustion may send the conversation to iChat.
An advertised 1M group window must not silently move a long conversation to a
paid fallback because Magpie cached the subscription's default 500K window.

## Historical Design

The pinned `codex-quota-only.patch` adds opt-in `quotaOnly` to explicit, flat,
ordered chat/Responses groups. Routing rules, nested groups, sink, and
first-token fallback are rejected for this policy. Normal groups retain their
existing behavior.

After authorization, account, checkpoint, and image filters, only the first
member enters the request loop. Later members remain deferred. A 429 classified
as quota exhaustion activates the next member; transient rate limits, overload,
authentication errors, context overflow, and unavailable members do not. No
reply is replayed after output has reached the client. Retries remain within
the active member, and each new request starts with the primary again instead
of following cross-member session affinity.

Ordinary context filtering records `skipReason`, `estimatedInput`, and
`contextWindow` in the route's excluded candidates. Quota-only routes record
fallbacks as `awaiting-primary-quota` until activated. Missing or explicitly
filtered primaries fail closed rather than being mistaken for exhausted quota.

`configure-codex-quota-only.py` updates only ordered Codex/iChat GPT-6 pairs and
the Codex provider's per-model windows. It uses the native catalog's reported
maximum (872K on the pinned catalog), preserves explicit differing overrides,
and requires a private backup before applying. It does not change the native
client's 1M setting, credentials, other groups, or conversation files. The group
window remains a client-facing declaration, not proof of a backend limit.

## Validation

Focused tests cover long-primary requests, quota versus rate/auth/overload/
overflow errors, native Codex SSE failures, recovery from fallback affinity,
missing primaries, nested-policy rejection, and no replay after output.
Existing roomy and Codex quota tests retain their prior fallback behavior.
Configuration tests cover credential preservation, unchanged unrelated groups,
idempotency, and refusing to replace an explicit model-window override.
