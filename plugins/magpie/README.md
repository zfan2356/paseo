# Magpie for Paseo

Optional plugin embedding Magpie's own web management page. Accounts, routes,
usage, plugins and settings come directly from Magpie; Paseo does not reimplement
that UI. Its `magpie.snapshot` RPC still supplies the desktop menu bar and composer
source/speed shortcuts. It is not registered as a built-in plugin.

After first opening a host's page, its webview remains resident for the renderer's
lifetime. Closing the panel or switching hosts only parks it; reopening reuses
the same guest, navigation and form state without fetching another sign-in link.
Local and CVM pages each own one independent instance. App exit releases them.
An explicit retry replaces only the failed host's page. Hidden pages keep their
last viewport and do not intercept clicks or keyboard input; browser throttling
remains enabled when the app window is hidden.

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

The surface loads the original page from `127.0.0.1:3430`. On Electron it uses
Paseo's existing sandboxed webview profile; browser previews use an iframe.
`magpie.web.open` obtains the existing host-local management sign-in link only
when opening the page. Magpie exchanges the key for its HTTP-only cookie and
removes it from the page URL. The link is not part of quota snapshots or saved
plugin configuration. No Magpie frontend assets are copied or restyled.

By default the page targets Magpie on the same Mac as the client. For a remote
Paseo daemon, forward its management port to the client and create
`~/.config/magpie/paseo-web.json` on the daemon host:

```json
{ "url": "http://cvm-magpie.localhost:3431" }
```

This URL must be an HTTP(S) origin without credentials, path, query or fragment.
For CVM, forward Mac `127.0.0.1:3431` to CVM `127.0.0.1:3430` with SSH. Chromium
resolves `*.localhost` to loopback. Use this distinct hostname so the local and
remote Magpie instances do not overwrite each other's identically named cookies.
The key stays on its owning host and travels only through the authenticated
Paseo RPC and the encrypted SSH tunnel. Keep both management listeners on
loopback. Other client machines need the same forwarding setup or their own
reachable management origin.

This setting supports a plugin installed on the remote Paseo daemon. The
separate SSH RPC bridge still refuses to return a client-loopback URL.

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
With the local management server running, use
`npm run test:e2e:real --workspace=@getpaseo/app -- e2e/browser/magpie-native.real.spec.ts`
for the browser page and
`node packages/desktop/e2e/magpie-native.electron.mjs /Applications/Paseo.app`
for the installed Electron renderer. The desktop test uses an isolated profile
and daemon; it leaves the running app and production daemon untouched.
Set `PASEO_MAGPIE_REMOTE_ENDPOINT=<cvm-host>:6767` to additionally check the deployed
remote plugin and return to the local page, proving the two login cookies do not
collide. This check requires the client-side SSH forward described above.
