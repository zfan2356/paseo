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

The projection tests verify model counts and removal of credential fields.
`server/web.test.ts` verifies local and forwarded management links, independent
cookie hostnames, rejected URL credentials/paths and invalid/missing key handling.
`magpie-native.real.spec.ts` opens the real upstream page, navigates its provider
and routing views, and checks that the key has left the page URL.
`packages/desktop/e2e/magpie-native.electron.mjs` checks the same navigation in
the installed Electron renderer, verifies the page has no Node access and
occupies the pane, and exercises the packaged daemon and terminal smoke.
Starter tests verify process-local home selection and rejection of invalid paths
or unrelated settings. Reload the directory plugin to activate UI changes;
rebuilding or restarting Paseo is unnecessary.
