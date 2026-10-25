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
listener is exposed and neither Magpie nor Paseo needs a restart. Other desktop
clients require their own forward. Malformed configuration fails explicitly.

iOS uses the existing Paseo connection instead of the desktop's loopback URL.
The directory plugin reads Magpie's live root page and inlines its own scripts
and styles. A small page adapter carries GET/POST requests and their binary
responses through plugin RPC. The daemon fixes the destination to loopback port
3430 and adds the management cookie privately; neither the key nor a public
management endpoint is needed on the phone. Only management API paths, known
static resource paths and icons are accepted; traversal and external URLs are
rejected. Cookie headers never cross back to the page. The HTML wire size is
capped at 6 MiB and individual upstream responses at 4 MiB.

The existing app's registered `RNCWebView` displays this page. Its existing
`RNCWebViewModule` acknowledges each navigation lock. Replies use React Native's
`findNodeHandle` and `UIManager.dispatchViewManagerCommand` with the WebView's
existing `injectJavaScript` command. No app bundle, native dependency, core RPC
or daemon protocol changes are needed. Page networking stays blocked by CSP;
same-service images and masks use data URLs supplied by RPC. Clipboard writes
use Paseo's client clipboard, and HTTP(S) links open through its external opener.
History updates account for a local HTML document whose URL differs from its
virtual base URL.

This transport covers the built-in management views. Browser file downloads and
third-party plugin iframes are not transported. Native pages are recreated when
their surface unmounts; the renderer-resident desktop pages keep their existing
lifetime. Android keeps the existing external-browser behavior and is untested.
Real iPhone rendering and outbound messages were verified with the retired
probe below; the complete management-page command/reply path needs a phone run
after this rollout.

`plugins/magpie/server/projection.ts` continues to project display-only provider
data for menu-bar quotas and composer shortcuts. Quota failures remain distinct
from source configuration and never imply a fallback route exists.

`skills/deploy-magpie/scripts/magpie-start.py` accepts a private host-local
`~/.config/magpie/runtime.json` with an absolute existing `codexHome`. This overrides
CODEX_HOME only for Magpie; subscription credentials stay in their original home.
API credentials are registered in Magpie's private store, never in this repository.
No default agent routing is changed by this UI or startup configuration.

## Validation

The temporary `magpie-mobile-probe` was introduced in `4d3951a96` and its missing
native navigation acknowledgement was fixed in `d17896b0a`. Fabric installs the
decision delegate even without a JS listener, leaving the load pending until
the corresponding lock is answered. Real runs on 2026-10-25 at 23:21 and 23:25
UTC+08:00 used iOS 26.6.1 and React Native 0.86.3. They rendered the offline HTML
and delivered `navigation-allowed`, `ready`, `loaded` and two `clicked` events
to the daemon. The user confirmed normal interaction. That probe accessed no
accounts or management key. The user then requested its removal; its installed
entry and source directory are removed, with this evidence retained in history.
The working navigation contract is now owned by the main Magpie plugin.

`server/web.test.ts` covers resource-path confinement and page assembly;
`client/native-navigation.test.ts` checks both allowed and denied lock replies.
The mobile case in `magpie-native.real.spec.ts` uses the real Magpie page,
daemon and plugin RPC with a browser adapter for the WKWebView JS boundary. It
checks provider rendering, routing/usage/settings navigation, a harmless
unhandled POST returning 404, and blocked external requests. It does not replace
the final iOS command/reply check.

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
