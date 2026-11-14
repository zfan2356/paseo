# Codex compressed request compatibility

Status: active on CVM since 2026-11-10

## Original requirement

Codex conversations repeatedly stopped with `Codex: Bad Request`. Manual
compaction restored one conversation, but another failed after several tool
calls. Preserve diagnostic evidence and repair the request transport without
discarding conversation history or changing accounts.

## Evidence

On 2026-11-10, a captured request reproduced the failure through the running
gateway. Its final 264,588-byte JSON body completed on the same subscription
when sent plain or encoded with libzstd. The gateway's existing Go zstd bytes
returned HTTP 400 with exactly `{"detail":"Bad Request"}`. Both encodings
decoded to the same JSON. Go's streaming encoder also failed; its
`SpeedBetterCompression` encoder and a 128 KiB window both completed.

This isolates an upstream compatibility problem with some valid compressed
bodies. It does not establish which internal upstream decoder rejects them.
Raw conversation bodies, compressed samples and response traces stay in the
operator's private diagnostic directory; they are not repository fixtures.

## Design

`patches/magpie/codex-zstd-compatibility.patch` adds a bounded transport retry
before gateway error classification. For a ChatGPT `/responses` request that
Magpie compressed itself, the exact opaque HTTP 400 above is retried once
using `SpeedBetterCompression`. The JSON bytes, authorization, account,
session and other headers remain the same. The retry remains compressed,
including for large histories, and uses its actual Content-Length.

Native forwarding, pooled subscription requests and warm-up calls share the
same helper. Other hosts, preencoded requests, compaction endpoints, explicit
validation errors, quota responses and SSE responses are not retried by it.
A second refusal is returned normally. A diagnostic log records the session,
body size and retry status without recording credentials or conversation text.

The normal encoder stays unchanged. The fallback retains the existing 2 MiB
window and bounded encoder concurrency; its additional encoder is lazy.
There is no account rotation, rollout rewrite, context truncation or automatic
quota reset associated with this recovery.

## Validation and rollout

The gateway regression first reproduced the same client-visible 400 without
the patch. It covers native and pooled routes, exact JSON preservation,
different compressed bytes, correct lengths and unchanged account selection.
Provider tests cover the single-retry limit, explicit errors, quota responses,
large refusal bodies, cancellation and no replay of an SSE response.

The deployment lock validates this patch after the existing patches. Build
and verify a candidate before the consented Magpie restart. Installing a file
alone does not update the running process; Paseo does not need restarting.

The CVM rollout replayed the captured request through the updated production
gateway: the original 99,327-byte encoding received 400, the compatible
98,441-byte encoding completed with 200, and both decoded to the same JSON.
The original failed Paseo conversation then completed a native recovery check
without compaction or history edits. Its prior rollout prefix remained
byte-identical, and the Paseo process was not restarted.
