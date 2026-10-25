---
name: deploy-magpie
description: Build, deploy, verify, or roll back this repository's pinned Magpie CLI and optional Paseo integration on a local or SSH host.
---

# Deploy Magpie

Use the checkout containing `third_party/magpie.lock.json` and `plugins/magpie`.
The git submodule is the source pin; the lock records the expected revision, build version and ordered patch SHA-256 values. Fork-owned gateway fixes live under `patches/magpie/` and are applied to an archived source copy during a build; the submodule stays clean.
Do not substitute a release download, `latest`, or `magpie update`.

## Prepare and build

1. Identify the requested host. For SSH deployment, use an existing authorized SSH connection and run the commands in a checkout on that host. Reuse its credentials; do not copy account stores between machines.
2. Initialize `git submodule update --init third_party/magpie`. Read [the integration guide](../../plugins/magpie/README.md) for local versus SSH mode.
3. Run `python3 skills/deploy-magpie/scripts/deploy.py --check`, then `--dry-run`. The script refuses a mismatched or dirty submodule, a changed patch checksum, or a patch that no longer applies. It needs Git, Python 3 and Go; Go's toolchain selection follows the pinned `go.mod` (1.26.8). CI's `magpie-build` job tests and builds Linux amd64 and macOS arm64 artifacts from the same pin and patches; verify their `paseoRevision` and checksums before installation.
4. When deployment is requested, run `python3 skills/deploy-magpie/scripts/deploy.py --install`. It builds the CLI with `nogui`, records a checksum, and atomically replaces `~/.local/bin/magpie`. Existing config, provider accounts and routes are retained. An existing binary is backed up. Add `--with-middleware` only when the personal speed middleware is wanted; it registers a new installation or retains an existing one and its options. Migrate an existing middleware path separately; adding the same basename twice disables speed controls.

Pass `--repo /absolute/checkout` when invoking an installed copy of this skill from outside the checkout. The installer does not stop services or start a new one. Inspect the running service before replacing it. If a restart is in scope, stop only the identified Magpie process owned by this user, then run `~/.local/bin/magpie-start`. Never stop the Paseo daemon as part of Magpie deployment. A live older Magpie process keeps its old executable until restarted.

## Align Codex Windows

For Codex Unified window mismatches, review `custom-feat/magpie-codex-windows.md`.
Dry-run `scripts/configure-codex-windows.py`, then apply with
`--apply --backup-dir <private-directory>` when configuration changes are
authorized. This only aligns per-model windows; preserve group routing,
affinity, fallback behavior, credentials, and the client's context settings.
Do not restore the removed quota-only policy.

## Connect Paseo

Run `npm ci` and `npm run build:server` in the checkout, then `npm run typecheck --workspace=@getpaseo/builtin-plugins` before installing the source plugin. Confirm the target daemon's `pluginsEnabled` setting; enabling trusted unsandboxed plugins needs the user's authorization if it was not already given. Install with `paseo plugin install /absolute/checkout/plugins/magpie --id magpie`, or reload that ID if it already points here. Do not overwrite another installation without checking its path.

For an SSH bridge, deploy on the Magpie host first and set the bridge variables from the integration guide in the Paseo daemon's environment. Use an absolute path to Bun on noninteractive SSH hosts. Install Bun and the checkout's npm dependencies on the Magpie host; the persistent worker uses the checkout's `zod` and plugin SDK. Each bridge maintains its own login flow. Prefer installing directly on a remote Paseo daemon when one already manages the Magpie host.

## Verify and roll back

- Check `~/.local/bin/magpie --version` against the lock's build version. Check `GET http://127.0.0.1:3425/` after startup and require a JSON object with `name: "magpie"`; there is no `/health` endpoint. Bypass HTTP proxies for this loopback check. If it fails, inspect `~/.local/state/magpie/serve.log` locally without copying tokens or account records into chat.
- Require `paseo plugin ls` to show `magpie` running. Verify a snapshot and refresh from the target host, then check the desktop quota selector. Test source/speed changes only on a route the user requested. Login and route reconfiguration are separate actions, not deployment prerequisites.
- Report the source revision, binary version, plugin status, and whether the process was restarted. Never report secret key contents.
- To roll back, stop the identified Magpie process if authorized, atomically restore the saved binary in `~/.local/lib/magpie/backups`, then run `magpie-start`. Keep provider config and credentials. Restore the prior plugin source/revision and reload only that plugin if needed. Verify health and snapshot again.

To upgrade the pin, review upstream changes, select a specific commit, update both the gitlink and lock, and repeat targeted integration checks before deployment.
