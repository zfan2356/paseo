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

## Install

This plugin supports the official Magpie 0.1.3056 service and the older pinned
installation. Keep an existing official binary and service: the repository's
`third_party/magpie.lock.json` and deployment skill belong to the older patched
build and must not be applied over an official installation.

Build this checkout with `npm ci && npm run build:server`, then run
`npm run typecheck --workspace=@getpaseo/builtin-plugins`.
On the daemon host, create `~/.config/magpie/paseo-web.json` for an existing
`magpie daemon install --web` service:

```json
{ "runtime": "daemon" }
```

The plugin reads `~/.local/bin/magpie daemon web` in memory to obtain the
service's management origin and key. It never copies the key to a second file.
Start uses `magpie daemon start`; opening the panel never starts another service.
It leaves account discovery, agent defaults and subscription logins alone.

With trusted plugins enabled, install this directory:

```sh
paseo plugin install /absolute/checkout/plugins/magpie --id magpie
paseo plugin ls
```

The settings have separate responsibilities:

| Field           | Purpose                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime`       | `daemon` reuses the official service; `legacy` uses the old key file and starter. Missing means `legacy`.                                               |
| `managementUrl` | Optional daemon-side HTTP(S) origin for API and mobile resource requests; defaults to the service's origin, or legacy loopback `http://127.0.0.1:3430`. |
| `url`           | Optional browser/Electron origin reachable from the client; defaults to the management origin.                                                          |

Origins must have no credentials, path, query or fragment. An existing
`{ "url": "http://cvm-magpie.localhost:3431" }` remains a legacy configuration:
the host still uses loopback3430 and `~/.local/state/magpie/web-key`, while
the client uses its forwarded port. Legacy Start calls `~/.local/bin/magpie-start`.
For remote browser clients, choose a reachable management address or forward its
port to the client; distinct hostnames prevent local and remote cookies colliding.
A daemon-side reverse proxy can be named by `managementUrl`; the official service's
cookie name still uses its own listening port.

Browser/Electron obtains a sign-in link through the authenticated Paseo RPC.
Magpie exchanges its key for an HTTP-only cookie and removes it from the URL.
The key is absent from snapshots and plugin configuration. iOS instead receives
Magpie's page and proxies GET/POST requests through its existing Paseo connection;
the management key and cookies stay on the daemon. It needs no direct network
route from the phone to Magpie. Static and lazy JavaScript modules use the same
bridge; arbitrary external requests and path traversal are refused. Native
WebView availability is checked by the existing client surface.

To roll back, remove/disable the plugin with `paseo plugin remove magpie` or
`paseo plugin disable magpie`, then restore the previous `paseo-web.json` if one
existed. This leaves the official Magpie service running. Source updates use
`paseo plugin reload magpie`; do not restart the shared Paseo daemon.

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
`server/personal-speed.middleware.js`, from the legacy deployment. Official installations without an enabled middleware show this control as unavailable. An existing middleware installation and its options are retained; migrate its path separately if needed.
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
