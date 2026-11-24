# Safe local macOS app replacement

- Status: active
- Commits: `384fd1618`
- Ledger entry: "Safe local macOS app replacement"

## Original requirement

Installing a rebuilt fork used to mean overwriting `/Applications/Paseo.app`
by hand — while the agent doing the install was itself running inside that
app. That either killed the conversation mid-install or corrupted the live
bundle. The requirement: a one-command way to replace the installed app that
lets the current agent response finish, survives failure, and never leaves
two Paseo apps around.

## Design

A repository-owned installer (`packages/desktop/scripts/install-local-app.sh`,
exposed as `npm run install:desktop:local`) that:

- Registers a **unique one-shot LaunchAgent** with `RunAtLoad=true` and
  explicit `KeepAlive=false`, then quits Paseo after a delay so the in-flight
  agent response can land first.
- Performs a **staged swap**: verify the candidate signature, stage it, swap,
  verify the installed signature, relaunch — and roll back to the previous
  app if install or launch fails.
- On success removes the rollback copy, leaving exactly one installed app.
- Supports `--dry-run` (signature + plist validation only), which is required
  before every real invocation.
- **Never uses `launchctl submit`** — it previously inferred keepalive and
  replayed a completed installer, which is the class of bug this script
  exists to prevent. The LaunchAgent boots itself out after completion.

This stays a fork-local developer workflow; it is not an updater and is
unrelated to upstream release channels. Signing of the candidate is owned by
[stable-local-macos-signing.md](stable-local-macos-signing.md).
