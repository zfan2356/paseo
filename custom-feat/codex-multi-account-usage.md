# Codex subscription usage through Magpie

Status: active

## Original requirement

The CVM has two enabled Codex subscriptions registered in Magpie. The host's
Usage dialog must show each account's own allowances, plan and reset times.

## Design

The existing Codex usage source discovers enabled Magpie Codex logins through
its authenticated management connection. Each login becomes a separate Codex
card. Disabled, paused and expired Magpie logins are excluded. Matching native
logins keep their existing account keys and pinned windows; Magpie is tried
first and the native login remains available to the usage registry.

Account refresh uses Magpie's account-specific quota endpoint. Percentages and
reset timestamps come from its provider readings. Five-hour and weekly windows
keep Paseo's existing window identities. Missing readings and provider failures
remain errors, allowing the existing UI to retain the last successful values.

Credentials remain on the daemon host. The adapter never reads Magpie's login
store, changes routing or signs accounts in. Account keys contain hashes rather
than email addresses. Session usage retains its provider-owned mapping because
a routed conversation cannot be attributed to every account in the pool.

Regression coverage lives in the Codex source's `server/magpie.test.ts` and the
existing usage-modal browser suite.
