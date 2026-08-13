import { randomBytes } from "node:crypto";
import { createTerminalManager } from "./terminal-manager.js";
import { captureTerminalLines } from "./terminal-capture.js";
import { TerminalOutputCoalescer } from "./terminal-output-coalescer.js";
import {
  isPersistentTerminalWorkerLauncherProcess,
  isPersistentTerminalWorkerProcess,
  launchPersistentTerminalWorkerFromLauncher,
  listenPersistentTerminalWorkerServer,
  resolvePersistentTerminalWorkerRuntimeFromEnv,
  type PersistentTerminalWorkerServer,
  type PersistentTerminalWorkerServerConnection,
} from "./persistent-terminal-worker-transport.js";
import type { TerminalSession, TerminalStateSnapshotOptions } from "./terminal.js";
import type {
  TerminalWorkerRequest,
  TerminalWorkerStateResult,
  TerminalWorkerToParentMessage,
  WorkerTerminalInfo,
} from "./terminal-worker-protocol.js";

type TerminalCreateRequest = Extract<TerminalWorkerRequest, { type: "createTerminal" }>;
const PERSISTENT_ATTACH_TIMEOUT_MS = 3000;

const manager = createTerminalManager();
const unsubscribeByTerminalId = new Map<string, Array<() => void>>();
const outputCoalescerByTerminalId = new Map<string, TerminalOutputCoalescer>();
const terminalSessionsById = new Map<string, TerminalSession>();
const activityTokenByTerminalId = new Map<string, string>();

type WorkerMessageSender = (message: TerminalWorkerToParentMessage) => void;

let legacyMessageSender: WorkerMessageSender | null = null;
let legacyIpcClosing = false;
let persistentServer: PersistentTerminalWorkerServer | null = null;
const attachedPersistentConnections = new Set<
  PersistentTerminalWorkerServerConnection<TerminalWorkerRequest, TerminalWorkerToParentMessage>
>();
let persistentExitStarted = false;

interface InFlightTerminalCreateRequest {
  requestId: string;
  errorReported: boolean;
  sendResponse: WorkerMessageSender;
}

let inFlightTerminalCreateRequest: InFlightTerminalCreateRequest | null = null;

// The conpty failure signal is process-scoped, not request-scoped. Serializing
// creates keeps an async spawn failure attributable to exactly one request.
let createTerminalQueue: Promise<void> = Promise.resolve();

// node-pty completes its Windows conpty spawn asynchronously on a separate
// conout worker thread. When that spawn fails (bad cwd, missing command, etc.)
// it throws an exception there that cannot be caught at the call site and would
// otherwise crash this worker process and sever every existing terminal.
process.on("uncaughtException", (error) => {
  console.error("Terminal worker uncaught exception (kept alive):", error);
  reportInFlightTerminalCreateFailure(error);
});

function createPersistentMessageSender(
  connection: PersistentTerminalWorkerServerConnection<
    TerminalWorkerRequest,
    TerminalWorkerToParentMessage
  >,
): WorkerMessageSender {
  return (message) => {
    try {
      connection.transport.send(message);
    } catch (error) {
      connection.transport.destroy(
        error instanceof Error ? error : new Error("Terminal worker send failed"),
      );
    }
  };
}

function broadcastToParents(message: TerminalWorkerToParentMessage): void {
  legacyMessageSender?.(message);
  for (const connection of attachedPersistentConnections) {
    createPersistentMessageSender(connection)(message);
  }
}

function maybeExitPersistentWorker(): void {
  if (
    !isPersistentTerminalWorkerProcess() ||
    terminalSessionsById.size > 0 ||
    persistentExitStarted
  ) {
    return;
  }
  const server = persistentServer;
  if (!server) {
    setImmediate(maybeExitPersistentWorker);
    return;
  }
  if (server.connectionCount > 0) {
    return;
  }
  persistentExitStarted = true;
  void server
    .close()
    .catch(() => undefined)
    .finally(() => process.exit(0));
}

function buildTerminalStateResult(
  session: TerminalSession | undefined,
  options?: TerminalStateSnapshotOptions,
): TerminalWorkerStateResult {
  if (!session) {
    return null;
  }
  return { ...session.getStateSnapshot(options), replayPreamble: session.getReplayPreamble() };
}

function toTerminalInfo(session: TerminalSession): WorkerTerminalInfo {
  return {
    id: session.id,
    name: session.name,
    cwd: session.cwd,
    workspaceId: session.workspaceId,
    ...(session.linkedAgentId ? { linkedAgentId: session.linkedAgentId } : {}),
    ...(session.getTitle() ? { title: session.getTitle() } : {}),
    activity: session.getActivity(),
    ...(activityTokenByTerminalId.get(session.id)
      ? { activityToken: activityTokenByTerminalId.get(session.id) }
      : {}),
  };
}

function createActivityToken(): string {
  return randomBytes(32).toString("base64url");
}

function terminalWorkerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Terminal worker request failed";
}

function reportInFlightTerminalCreateFailure(error: unknown): void {
  if (!inFlightTerminalCreateRequest || inFlightTerminalCreateRequest.errorReported) {
    return;
  }
  inFlightTerminalCreateRequest.errorReported = true;
  inFlightTerminalCreateRequest.sendResponse({
    type: "response",
    requestId: inFlightTerminalCreateRequest.requestId,
    ok: false,
    error: terminalWorkerErrorMessage(error),
  });
}

function clearTerminalSubscriptions(terminalId: string): void {
  const subscriptions = unsubscribeByTerminalId.get(terminalId);
  if (subscriptions) {
    for (const unsubscribe of subscriptions) {
      try {
        unsubscribe();
      } catch {
        // no-op
      }
    }
  }
  unsubscribeByTerminalId.delete(terminalId);
  const coalescer = outputCoalescerByTerminalId.get(terminalId);
  if (coalescer) {
    coalescer.dispose();
    outputCoalescerByTerminalId.delete(terminalId);
  }
}

function watchTerminal(session: TerminalSession): void {
  clearTerminalSubscriptions(session.id);
  terminalSessionsById.set(session.id, session);

  // Coalesce pty output chunks into a single IPC message per ~5ms window so a
  // burst of small chunks no longer costs one process.send each. The batch
  // carries the LAST chunk's revision (the highest) so downstream snapshot
  // replay dedup stays correct.
  let pendingOutputRevision: number | undefined;
  const outputCoalescer = new TerminalOutputCoalescer({
    timers: { setTimeout, clearTimeout },
    onFlush: ({ payload }) => {
      const revision = pendingOutputRevision;
      pendingOutputRevision = undefined;
      broadcastToParents({
        type: "terminalMessage",
        terminalId: session.id,
        message: { type: "output", data: payload.toString("utf8"), revision },
      });
    },
  });
  outputCoalescerByTerminalId.set(session.id, outputCoalescer);

  const unsubscribeMessage = session.subscribe(
    (message) => {
      if (message.type === "output") {
        pendingOutputRevision = message.revision;
        outputCoalescer.handle(message.data);
        return;
      }
      // Non-output messages (snapshot/snapshotReady/titleChange) must not jump
      // ahead of buffered output: flush the coalescer first, then forward.
      outputCoalescer.flush();
      broadcastToParents({
        type: "terminalMessage",
        terminalId: session.id,
        message,
      });
    },
    // Creation already sends an authoritative state in terminalCreated. A second
    // asynchronous state snapshot can arrive after the create response and
    // overwrite a resize issued immediately by the caller.
    { initialSnapshot: "ready" },
  );
  const unsubscribeExit = session.onExit((info) => {
    outputCoalescer.flush();
    clearTerminalSubscriptions(session.id);
    terminalSessionsById.delete(session.id);
    activityTokenByTerminalId.delete(session.id);
    broadcastToParents({
      type: "terminalExit",
      terminalId: session.id,
      info,
    });
    maybeExitPersistentWorker();
  });
  const unsubscribeTitle = session.onTitleChange((title) => {
    outputCoalescer.flush();
    broadcastToParents({
      type: "terminalTitleChange",
      terminalId: session.id,
      title,
    });
  });
  const unsubscribeCommandFinished = session.onCommandFinished((info) => {
    outputCoalescer.flush();
    broadcastToParents({
      type: "terminalCommandFinished",
      terminalId: session.id,
      info,
    });
  });
  const unsubscribeActivity = session.onActivityChange((transition) => {
    broadcastToParents({
      type: "terminalActivityChange",
      terminalId: session.id,
      activity: transition.activity,
      previous: transition.previous,
    });
  });

  unsubscribeByTerminalId.set(session.id, [
    unsubscribeMessage,
    unsubscribeExit,
    unsubscribeTitle,
    unsubscribeCommandFinished,
    unsubscribeActivity,
  ]);
}

function enqueueCreateTerminalRequest(
  message: TerminalCreateRequest,
  sendResponse: WorkerMessageSender,
): Promise<void> {
  const nextRequest = createTerminalQueue.then(() =>
    handleCreateTerminalRequest(message, sendResponse),
  );
  createTerminalQueue = nextRequest.catch(() => {});
  return nextRequest;
}

async function handleCreateTerminalRequest(
  message: TerminalCreateRequest,
  sendResponse: WorkerMessageSender,
): Promise<void> {
  const request: InFlightTerminalCreateRequest = {
    requestId: message.requestId,
    errorReported: false,
    sendResponse,
  };
  inFlightTerminalCreateRequest = request;
  try {
    const { workspaceId } = message.options;
    if (!workspaceId) {
      throw new Error("workspaceId is required");
    }
    const activityToken = message.options.activityToken ?? createActivityToken();
    const session = await manager.createTerminal({
      ...message.options,
      workspaceId,
      activityToken,
    });
    if (request.errorReported) {
      session.kill();
      return;
    }
    activityTokenByTerminalId.set(session.id, activityToken);
    watchTerminal(session);
    const initialSnapshot = session.getStateSnapshot();
    broadcastToParents({
      type: "terminalCreated",
      terminal: toTerminalInfo(session),
      state: initialSnapshot.state,
    });
    sendResponse({
      type: "response",
      requestId: message.requestId,
      ok: true,
      result: {
        terminal: toTerminalInfo(session),
        state: initialSnapshot.state,
      },
    });
  } catch (error) {
    const terminalId = message.options.id;
    if (terminalId) {
      activityTokenByTerminalId.delete(terminalId);
    }
    reportInFlightTerminalCreateFailure(error);
  } finally {
    if (inFlightTerminalCreateRequest === request) {
      inFlightTerminalCreateRequest = null;
    }
  }
}

async function handleRequest(
  message: TerminalWorkerRequest,
  sendResponse: WorkerMessageSender,
): Promise<void> {
  switch (message.type) {
    case "attach": {
      for (const session of terminalSessionsById.values()) {
        outputCoalescerByTerminalId.get(session.id)?.flush();
        sendResponse({
          type: "terminalCreated",
          terminal: toTerminalInfo(session),
          state: session.getStateSnapshot().state,
        });
      }
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "createTerminal": {
      await enqueueCreateTerminalRequest(message, sendResponse);
      return;
    }

    case "registerCwdEnv": {
      manager.registerCwdEnv({ cwd: message.cwd, env: message.env });
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "setActivity": {
      await manager.setTerminalActivity(message.terminalId, message.state);
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "clearAttention": {
      await manager.clearTerminalAttention(message.terminalId);
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "setTitle": {
      manager.setTerminalTitle(message.terminalId, message.title);
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "killTerminal": {
      manager.killTerminal(message.terminalId);
      // Removal is owned by session.onExit -> terminalExit; the parent mirror
      // clears contribution and emits terminalsChanged from that single path.
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "killTerminalAndWait": {
      await manager.killTerminalAndWait(message.terminalId, message.options);
      clearTerminalSubscriptions(message.terminalId);
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "getTerminalState": {
      // Flush buffered output before snapshotting: the headless state already includes it,
      // so if the coalescer emitted it afterward (in a batch carrying a revision past the
      // snapshot's) the controller's revision dedup wouldn't drop it and the client would
      // see the bytes twice. Flushing first sends them with a revision <= the snapshot's.
      outputCoalescerByTerminalId.get(message.terminalId)?.flush();
      sendResponse({
        type: "response",
        requestId: message.requestId,
        ok: true,
        result: buildTerminalStateResult(manager.getTerminal(message.terminalId), message.options),
      });
      return;
    }

    case "captureTerminal": {
      const session = manager.getTerminal(message.terminalId);
      const result = session
        ? captureTerminalLines(session, {
            start: message.start,
            end: message.end,
            stripAnsi: message.stripAnsi,
          })
        : { lines: [], totalLines: 0 };
      sendResponse({
        type: "response",
        requestId: message.requestId,
        ok: true,
        result,
      });
      return;
    }

    case "killAll": {
      manager.killAll();
      for (const terminalId of Array.from(unsubscribeByTerminalId.keys())) {
        clearTerminalSubscriptions(terminalId);
      }
      terminalSessionsById.clear();
      activityTokenByTerminalId.clear();
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }

    case "send": {
      const session = manager.getTerminal(message.terminalId);
      session?.send(message.message);
      sendResponse({ type: "response", requestId: message.requestId, ok: true });
      return;
    }
  }
}

function handleRequestWithErrorResponse(
  message: TerminalWorkerRequest,
  sendResponse: WorkerMessageSender,
): void {
  void handleRequest(message, sendResponse).catch((error: unknown) => {
    sendResponse({
      type: "response",
      requestId: message.requestId,
      ok: false,
      error: terminalWorkerErrorMessage(error),
    });
  });
}

function startLegacyIpcWorker(): void {
  legacyMessageSender = (message) => {
    if (legacyIpcClosing || !process.connected || !process.send) {
      return;
    }
    try {
      process.send(message, (error) => {
        if (error) {
          legacyIpcClosing = true;
        }
      });
    } catch {
      legacyIpcClosing = true;
    }
  };
  process.on("message", (message: TerminalWorkerRequest) => {
    if (legacyMessageSender) {
      handleRequestWithErrorResponse(message, legacyMessageSender);
    }
  });
  process.once("disconnect", () => {
    legacyIpcClosing = true;
    legacyMessageSender = null;
    manager.killAll();
  });
}

async function startPersistentWorker(): Promise<void> {
  process.title = "Paseo Terminal Worker";
  if (process.connected) {
    await new Promise<void>((resolve) => process.once("disconnect", resolve));
  }
  const runtime = resolvePersistentTerminalWorkerRuntimeFromEnv();
  persistentServer = await listenPersistentTerminalWorkerServer<
    TerminalWorkerRequest,
    TerminalWorkerToParentMessage
  >({
    runtime,
    singleClient: false,
    onConnectionCountChange: () => maybeExitPersistentWorker(),
    onConnection: (connection) => {
      let attached = false;
      const sendResponse = createPersistentMessageSender(connection);
      const attachTimeout = setTimeout(() => {
        if (!attached) {
          connection.transport.destroy(new Error("Timed out waiting for terminal worker attach"));
        }
      }, PERSISTENT_ATTACH_TIMEOUT_MS);
      attachTimeout.unref();
      connection.transport.onMessage((message) => {
        if (!attached) {
          if (message.type !== "attach") {
            connection.transport.destroy(
              new Error("The first terminal worker request must be attach"),
            );
            return;
          }
          attached = true;
          clearTimeout(attachTimeout);
          attachedPersistentConnections.add(connection);
        }
        handleRequestWithErrorResponse(message, sendResponse);
      });
      connection.transport.onClose(() => {
        clearTimeout(attachTimeout);
        if (attached) {
          attachedPersistentConnections.delete(connection);
        }
        maybeExitPersistentWorker();
      });
    },
  });
}

if (isPersistentTerminalWorkerLauncherProcess()) {
  void launchPersistentTerminalWorkerFromLauncher()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error("Persistent terminal worker launcher failed:", error);
      process.exit(1);
    });
} else if (isPersistentTerminalWorkerProcess()) {
  void startPersistentWorker().catch((error: unknown) => {
    console.error("Persistent terminal worker failed to start:", error);
    process.exit(1);
  });
} else {
  startLegacyIpcWorker();
}
