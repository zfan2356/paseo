# Magpie for Paseo

Optional plugin for account sign-in, quota inspection, personal/ichat source selection,
and model-supported Ultra fast controls. Its `magpie.snapshot` RPC also supplies the
desktop menu bar. It is not registered as a built-in plugin.

Magpie source is included as the `third_party/magpie` submodule from
[yetone/magpie](https://github.com/yetone/magpie), pinned to
`9572a35761c2606257e8493ab47dedda38eb6b88`. The source keeps its upstream license.
Build metadata lives in `third_party/magpie.lock.json`; use the
[deployment skill](../../skills/deploy-magpie/SKILL.md) to build and install it.
The CLI's `serve` workflow does not invoke the GUI application updater. Keep the
versioned binary and avoid `magpie update` to retain this pin.

## Install

From this repository, build dependencies with `npm ci && npm run build:server`,
then typecheck with `npm run typecheck --workspace=@getpaseo/builtin-plugins`.
On a daemon where trusted plugins are enabled:

```sh
paseo plugin install /absolute/checkout/plugins/magpie --id magpie
paseo plugin ls
```

The default backend runs beside Magpie on the daemon host. It reads the management
key from `~/.local/state/magpie/web-key`, uses management at `127.0.0.1:3430` and
the gateway at `127.0.0.1:3425`. The start action calls `~/.local/bin/magpie-start`.
These paths match the deployment script. No keys or account stores belong in this
repository. RPC responses project only display data and never raw provider records.

The account page displays every configured source, including Cursor and custom API
providers such as iChat and DeepSeek, with the number of exposed models. A ready
source means configured, not a successful inference or a known remaining balance.
API sources without a quota endpoint do not invent subscription or balance data.

If Magpie must use a different Codex account directory than the daemon or shell,
create a private `~/.config/magpie/runtime.json` containing
`{"codexHome":"/absolute/path/to/subscription-home"}` and restart Magpie. The
starter applies this directory only to the Magpie child process; it does not copy
credentials or change other Codex launchers. The directory must already exist.

Connect Paseo to the daemon on the Magpie host to use it remotely. When Magpie is on
an SSH host without a Paseo daemon, set these variables in the local daemon's environment:

| Variable                  | Meaning                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `PASEO_MAGPIE_SSH_HOST`   | SSH alias or `user@host`; uses existing SSH authentication |
| `PASEO_MAGPIE_SSH_PORT`   | Optional, defaults to `22`                                 |
| `PASEO_MAGPIE_REMOTE_DIR` | Absolute path to this plugin directory on the remote host  |
| `PASEO_MAGPIE_REMOTE_BUN` | Bun executable on that host; absolute path recommended     |

The remote checkout needs `npm ci` and built workspace dependencies. A persistent
SSH worker keeps login ownership across requests and cancels its pending flow when
disconnected. SSH uses batch mode and does not prompt for passwords or approve new
host keys. Confirm host access before loading the bridge. Transport errors are shown
in the surface and the next request reconnects.

## Source and speed controls

Only two-member routes ordered as `codex/<model>, ichat/<model>` or
`claude/<model>, ichat/<model>` are editable here. Other routes remain visible.
Auto uses order routing; selecting an explicit source requires it to be ready.
Ultra fast requires an explicit personal Codex capability and the optional
`server/personal-speed.middleware.js`, installed via the deployment skill's
`--with-middleware` flag. An existing middleware installation and its options are retained; migrate its path separately if needed.
It does not promote an ichat fallback to the personal subscription tier.

`server/sync-codex-catalog.mjs` is an optional Bun script for the existing custom
catalog workflow: it reads `~/.codex/paseo-models-1m.json`, merges actual personal
model capabilities, and writes `~/.config/magpie/paseo-codex-models.json` atomically.
Use it only when that custom catalog is configured; deployment does not change
agent catalogs, provider logins or routes.

After editing, typecheck and `paseo plugin reload magpie`. Validate the selected
host's snapshot, refresh/error states and compact layout. Backend tests run with
`npm run test --workspace=@getpaseo/builtin-plugins -- magpie/server --bail=1`.
