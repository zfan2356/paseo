# ACP stale feature fallback

- Status: active
- Ledger entry: "ACP sessions tolerate retired feature preferences"

## Original requirement

After Cursor moved fast mode from a standalone ACP session option into model
IDs, Paseo still restored the previously saved `fast=true` preference. Cursor
no longer advertised that option, so every new conversation failed before its
first prompt with `acp does not expose ACP feature 'fast'`.

The requirement: provider upgrades may retire a previously advertised feature
without making saved Paseo conversations or New Agent preferences unusable.

## Design

- During session initialization, Paseo applies a saved ACP feature override
  only when the new session advertises the matching config option.
- A missing option produces a warning and leaves the provider default intact.
- Explicit feature changes on a live session remain strict. Unsupported
  features, invalid values, and ACP transport failures still surface as errors.
- The fallback is provider-agnostic because ACP config options are dynamic and
  any provider can remove or scope an option across releases.
