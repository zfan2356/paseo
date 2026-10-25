# Magpie account and API sources

Status: active

## Original requirement

The CVM already has Cursor and Codex subscriptions plus iChat and DeepSeek API
credentials. Paseo must display and use all sources rather than showing only
Codex/Claude login cards or reading a legacy Codex account directory.

## Design

The Magpie surface embeds the upstream management page served by the local
Magpie process. The user explicitly requires Magpie's own UI rather than a
Paseo recreation. Electron uses the existing sandboxed browser profile; browser
previews use an iframe. The plugin obtains a sign-in link on demand and Magpie
exchanges it for an HTTP-only cookie. The key never enters quota snapshots or
saved configuration. SSH mode refuses a loopback link to the wrong machine.

The user requires pages to remain open while Paseo runs, not reload on every
route visit. A renderer-owned registry keeps one permanent body-level webview
per host after first use. Route components own only a measured anchor; leaving
the route parks the permanent surface without moving or removing its guest.
The hidden surface is inert and clipped to 1x1 while the guest keeps its last
viewport. Reopening restores geometry and page state. Sign-in queries stay in
memory, and the resident link seeds a replacement plugin installation. Nothing
is persisted to disk; renderer exit releases all guests. Explicit retry replaces
only the failed host. This remains a plugin-only overlay, with no core route,
terminal or browser-runtime changes.

For CVM, a private `~/.config/magpie/paseo-web.json` on the daemon host selects
`http://cvm-magpie.localhost:3431`. A Mac LaunchAgent
`com.paseo.magpie-cvm-tunnel` maintains an SSH forward from loopback port 3431 to
CVM loopback port 3430, reconnecting on failure. The distinct hostname isolates
the remote cookie from local Magpie's identically named cookie. No remote
listener is exposed and neither Magpie nor Paseo needs a restart. Other client
machines require their own forward. Malformed configuration fails explicitly.

`plugins/magpie/server/projection.ts` continues to project display-only provider
data for menu-bar quotas and composer shortcuts. Quota failures remain distinct
from source configuration and never imply a fallback route exists.

`skills/deploy-magpie/scripts/magpie-start.py` accepts a private host-local
`~/.config/magpie/runtime.json` with an absolute existing `codexHome`. This overrides
CODEX_HOME only for Magpie; subscription credentials stay in their original home.
API credentials are registered in Magpie's private store, never in this repository.
No default agent routing is changed by this UI or startup configuration.

## Validation

An opt-in `plugins/magpie-mobile-probe` directory plugin tests the user's existing
iOS app without rebuilding it. Open **Magpie 手机测试**, then start the offline
test and tap the button inside the green page. The plugin references the
`RNCWebView` host view already registered by the app; it does not register another
view or import an unavailable host module. It accesses the existing
`RNCWebViewModule` through React Native's TurboModule registry to acknowledge each
`onShouldStartLoadWithRequest` lock, allowing only `about:blank` and its fragments.
Fabric installs this delegate even without a JS listener; omitting the response
leaves the first load waiting indefinitely. The first real iPhone run registered
the view but produced only the native background and no load/message events.
Probe v2 adds this handshake and an eight-second readiness diagnostic.
An error boundary reports a missing JavaScript view registration.
The self-contained page checks JavaScript and native message delivery without a
network request, account access, or Magpie management key. Runtime facts and
bounded probe events go to that plugin's normal logs over the existing RPC.

The real iPhone run on 2026-10-25 at 23:21 UTC+08:00 used iOS 26.6.1 and React
Native 0.86.3. Its screenshot shows the rendered HTML and running JavaScript;
daemon logs received `navigation-allowed`, `ready`, and `loaded` from that phone.
This verifies inline rendering and the page-to-plugin-to-daemon message path
without rebuilding the app or restarting the daemon. The screenshot's click
count was zero and no `clicked` event was received, so manual click delivery is
still unverified. Other app versions and Android are untested. The probe does
not yet load the real Magpie page, change the main plugin, or solve access to
the Mac-only forwarded management origin.

The projection tests verify model counts and removal of credential fields.
`server/web.test.ts` verifies local and forwarded management links, independent
cookie hostnames, rejected URL credentials/paths and invalid/missing key handling.
`magpie-native.real.spec.ts` opens the real upstream page, navigates its provider
and routing views, and checks that the key has left the page URL.
`packages/desktop/e2e/magpie-native.electron.mjs` checks the same navigation in
the installed Electron renderer, verifies the page has no Node access and
occupies the pane, and exercises the packaged daemon and terminal smoke.
Both browser and Electron regressions close/reopen the page three times and
assert unchanged page birth time and native navigation. Electron also verifies
unchanged guest IDs, hidden input isolation and repeated local/CVM SPA switches
with exactly two resident guests.
Starter tests verify process-local home selection and rejection of invalid paths
or unrelated settings. Reload the directory plugin to activate UI changes;
rebuilding or restarting Paseo is unnecessary.
