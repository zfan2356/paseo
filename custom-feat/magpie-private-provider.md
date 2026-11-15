# Magpie host-local provider adapter

Status: active

## Original requirement

Remove an extra compatibility service from the inference path without putting
private endpoint addresses, credentials or organization metadata into the fork.
Keep the existing gateway's routing, retries and conversation recovery.

## Design

`patches/magpie/private-provider.patch` extends the pinned source with a
`privateConfig` reference on a plain provider. A host-local, owner-only YAML file
supplies Bearer authentication, protocol bases, extra headers, optional model
protocol prefixes and excluded model IDs. Public code contains no deployment
values. Keep the existing provider ID, groups and model IDs when migrating.

Generation and model refresh both use the file. The adapter makes one upstream
attempt at a time and never follows redirects. Optional error normalization
exposes wrapped status/code fields to the existing gateway; an unfinished
Responses stream becomes an explicit failure. Existing retry budgets, route
tracking, output-commit boundaries and the context-recovery patches remain in
control. No provider plugin, new listener or extra retry loop is introduced.

The source pin stays unchanged. The deployment lock pins this patch's checksum
after the existing context/history patches; builds apply them to an archive
without dirtying the submodule. The patched source's subsystem reference owns
the YAML schema. This version supports Bearer credentials, not HMAC signing or
the retired compatibility service's optional server-side search bridge.

## Validation and rollout

Run `TestPrivate*` in the provider and gateway packages, the existing retry,
patience and native reasoning recovery regressions, and the deployment tests.
Fixtures use loopback servers and synthetic secrets only. Scan staged blobs
against actual local credential values and endpoint/organization identifiers
before publication, without printing matches.

Install only a build from the pushed lock and patch set. Creating the private
file or installing a binary does not restart a running gateway. Add the file
reference to the existing provider after preserving a private rollback copy;
an older binary ignores that new field and retains its prior route. Restart
only the identified gateway with explicit consent, then verify direct generation,
tools and model refresh before retiring the old compatibility service. Never
restart Paseo or rewrite native conversation histories for this migration.
