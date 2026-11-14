# Magpie subscription and iChat context recovery

Status: active

## Original requirement

Existing Codex conversations must continue when switching between the user's
ChatGPT subscription and iChat. Earlier turns contain private reasoning sealed
by their inference source; another source can reject it with
`invalid_encrypted_content`. Recovery must preserve messages, tools, model and
speed choices and must not require editing the conversation's rollout.

## Design

The pinned Magpie source is built with the reviewed patches in
`patches/magpie/`. Native Codex's subscription relay
handles both HTTP refusals and pre-output SSE failures. A refusal naming a
reasoning item removes the request's reasoning items together, so a long history
does not exhaust the retry budget one item at a time. Refused seals are remembered
per sign-in, model and conversation; newly generated reasoning still passes.
Once output reaches the client, an error is returned without replay.

Signed-in GPT-6 native compaction produces portable summaries on both the
compact endpoint and compaction-trigger requests when native compaction is off. Legacy sealed checkpoints moving to iChat are read with the
original Codex sign-in and returned as a portable checkpoint, so the client
retains the migration once. A checkpoint the original source cannot read is
never dropped or flattened into an incomplete summary. Explicit native
compaction stays bound to its recorded writer.

`codex-paginated-history.patch` excludes paginated histories from upstream's
background, disconnect, and shutdown portability sweeps. Codex persists byte
offsets in its history index; retaining line counts and taking an idle thread's
writer lock does not make a length-changing rewrite safe. Legacy histories keep
the upstream behavior.

The deployment lock verifies the patch checksum. Builds apply it to an archived
copy of the clean upstream submodule and record both the source pin and patch
hash in the artifact manifest. An upstream update that breaks patch application
fails before building or installing. CI's existing workflow builds both host
architectures after the Go checks. These patch and deployment paths are the
fork's merge-preservation record for this feature.

## Validation

`TestCodexNativeForeignReasoningRecovery` is red without the patch for eight old
reasoning items and for an SSE failure. It verifies successful continuation,
subsequent-turn filtering, independent conversations/accounts, retained tools
and Ultrafast. `TestCodexNativeDoesNotReplayAfterOutput` holds the no-replay
boundary. Deployment tests reject altered patches and confirm that the build
uses the patch without modifying the source checkout or account configuration.

Live acceptance uses an isolated gateway and Codex test conversation with real
subscription and iChat credentials, checking remembered facts and tool output
after subscription → iChat → subscription transitions, including compaction.
`--seed-magpie` first creates a legacy checkpoint with the earlier binary and
then validates automatic migration by the candidate without rewriting history.
Migration returns the portable checkpoint and the actual target-source reply
together; it never ends the user turn with only a checkpoint. Production conversations
are not rewritten by this gateway fix.

`TestPortCodexRolloutsPreservesPaginatedOffsets` checks
byte-for-byte preservation of both plain and compressed paginated rollouts.
