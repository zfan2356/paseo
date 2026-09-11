# Shared Codex app server

Status: implemented, opt-in; production activation is separate.

## Original requirement

Show Paseo's Codex conversations in the Codex desktop app's native conversation
view. A conversation has one active turn, with two clients that can observe its
output and interrupt it. Sharing the history directory alone only shares stored
messages: independently loaded app servers conflict on Codex's writer lock.

## Design

Paseo can attach to an existing local Codex app server over its Unix WebSocket.
Each Paseo session owns a connection, not a process. The desktop app connects to
the same server and native thread ID. No transcript conversion, copied sessions,
new Paseo RPC, or frontend-specific rendering is involved.

Configure the provider in `PASEO_HOME/config.json`:

```json
{
  "agents": {
    "providers": {
      "codex": {
        "env": {
          "PASEO_CODEX_APP_SERVER_SOCKET": "/root/.codex/app-server-control/app-server-control.sock"
        }
      }
    }
  }
}
```

This is a configuration fragment, not a replacement for the whole file. Remove
this provider's `command` override and other `env` entries when opting in. The
shared server owns its binary, provider routing, credentials, global configuration,
and process environment. Paseo refuses conflicting launch overrides instead of
silently dropping them. Per-session model, permissions, and tool configuration
still use the normal thread/turn APIs. Joining an already-loaded thread does not
replace its existing configuration; explicit subsequent turn settings still apply.
Goal support follows the shared server's configuration rather than enabling a flag
on a new process. The server must already be running. A missing socket fails
explicitly; Paseo never starts a fallback writer or restarts the shared service.

`shared-app-server.ts` owns configuration validation and the socket transport.
The existing JSON-RPC client retains correlation, notifications, and approvals.
It closes only the socket in shared mode and never kills the server process.
The socket disables `perMessageDeflate`: Codex 0.149.0 rejects the default `ws`
extension offer on its control socket.

The provider session explicitly resumes once per connection to subscribe, even
when the server already lists that thread as loaded. It ignores broadcast
thread-creation notifications and takes its own ID from the request response.
Existing child-thread routing remains separate from the root timeline. Native
turns receive the same Paseo liveness events as locally submitted turns; interrupt
uses the actual native turn ID. Closing an observer does not cancel an outstanding
shared approval. Conversation TUI launches use `--remote unix://...` to avoid
creating another writer for the same thread.

## Activation and limits

- Default behavior remains an independent app-server process.
- Existing independent writers are not migrated, interrupted, or force-unlocked.
  Finish and close them before reopening their sessions in the shared mode.
- Socket access grants control of the local Codex service. Keep its normal
  owner-only filesystem permissions. No TCP listener is added by this feature.
- The desktop app must use that same host and server. A Mac-local server and a
  CVM server are separate execution planes even when paths look similar.
- Reconnection happens through the existing session lifecycle and resumes the
  same thread. This feature does not restart a disconnected service.
- The full native desktop UI, mobile clients, and packaged applications were not
  exercised for this change. The focused test uses a real isolated Codex 0.149.0
  server and deterministic loopback inference; it does not contact a real model.
- Publishing this code does not enable it. Production configuration and daemon
  refresh still require explicit user approval.

## Verification

```sh
npx vitest run packages/server/src/server/agent/providers/codex/shared-app-server.test.ts --bail=1
npx vitest run packages/server/src/server/agent/providers/codex/shared-app-server.local.e2e.test.ts --bail=1 --maxWorkers=1
npx vitest run packages/server/src/terminal/codex-fork-terminal.test.ts --bail=1
```

The local integration test covers bidirectional starts and interrupts, native
paginated history, rejection of a second turn, unrelated-thread isolation,
mid-turn reattachment, and continued service availability after Paseo detaches.
