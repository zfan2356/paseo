# Magpie Codex member windows

Status: active

## Original requirement

Keep Magpie's original ordered routing, session affinity, context filtering,
and fallback behavior. Correct only the Codex member's stale default window,
which caused a long Unified conversation to skip a working subscription.

## Design

`configure-codex-windows.py` aligns the per-model Codex windows used by the
existing router with the native catalog's reported maximum: 872K for the four
GPT-6 models on the pinned catalog. It leaves all group definitions unchanged,
including their advertised 1M context, and does not change the client's 1M
window or 700K auto-compaction setting. An explicit differing model override
requires review rather than being overwritten.

The quota-only extension is removed. Its historical feature document is not
an active merge invariant. The history-index preservation and encrypted-context
recovery patches remain active.

Configuration tests require complete preservation of group routing, custom
affinity, credentials, unrelated providers, and client-facing windows.
