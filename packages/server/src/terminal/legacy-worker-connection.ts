import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { join } from "node:path";
import {
  connectPersistentTerminalWorker,
  resolvePersistentTerminalWorkerRuntime,
  type PersistentTerminalWorkerConnection,
} from "./persistent-terminal-worker-transport.js";
import type { TerminalWorkerConnection } from "./terminal-worker-client.js";
import type {
  TerminalWorkerRequest,
  TerminalWorkerToParentMessage,
  WorkerListedTerminal,
} from "./terminal-worker-protocol.js";

interface LegacyAttachRequest {
  type: "attach";
  requestId: string;
}
type LegacyRequest = TerminalWorkerRequest | LegacyAttachRequest;
type LegacyConnection = PersistentTerminalWorkerConnection<
  TerminalWorkerToParentMessage,
  LegacyRequest
>;

// COMPAT(forkTerminalWorker): added in v0.14.0-beta.2, remove after legacy NDJSON workers drain.
export class LegacyWorkerConnection extends EventEmitter implements TerminalWorkerConnection {
  // The legacy handshake has no PID; this adapter is never passed to the process reaper.
  readonly workerPid = 0;
  private readonly listings = new Map<string, WorkerListedTerminal[]>();
  private readonly connection: LegacyConnection;

  constructor(connection: LegacyConnection) {
    super();
    this.connection = connection;
    connection.transport.onMessage((message) => {
      if (message.type === "terminalCreated") {
        for (const listing of this.listings.values()) {
          listing.push({
            terminal: message.terminal,
            state: message.state,
            activityToken: message.terminal.activityToken ?? null,
            replayPreamble: "",
          });
        }
      }
      if (message.type === "response" && this.listings.has(message.requestId)) {
        const result = this.listings.get(message.requestId);
        this.listings.delete(message.requestId);
        if (message.ok) {
          this.emit("message", { ...message, result });
          return;
        }
      }
      this.emit("message", message);
    });
    connection.transport.onClose(() => this.emit("close"));
  }

  get connected(): boolean {
    return !this.connection.transport.isClosed;
  }

  send(message: TerminalWorkerRequest, callback: (error: Error | null) => void): boolean {
    const request =
      message.type === "listTerminals"
        ? { type: "attach" as const, requestId: message.requestId }
        : message;
    if (message.type === "listTerminals") this.listings.set(message.requestId, []);
    try {
      const accepted = this.connection.transport.send(request);
      queueMicrotask(() => callback(null));
      return accepted;
    } catch (error) {
      this.listings.delete(message.requestId);
      queueMicrotask(() => callback(error instanceof Error ? error : new Error(String(error))));
      return false;
    }
  }

  disconnect(): void {
    this.connection.transport.end();
  }
}

function isAbsentEndpoint(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ECONNREFUSED")
  );
}

export async function connectLegacyWorker(
  paseoHome: string,
): Promise<TerminalWorkerConnection | null> {
  try {
    await access(join(paseoHome, "runtime", "terminal-worker", "auth-token"));
  } catch (error) {
    if (isAbsentEndpoint(error)) return null;
    throw error;
  }
  const runtime = resolvePersistentTerminalWorkerRuntime(paseoHome);
  try {
    return new LegacyWorkerConnection(
      await connectPersistentTerminalWorker<TerminalWorkerToParentMessage, LegacyRequest>(runtime),
    );
  } catch (error) {
    if (isAbsentEndpoint(error)) return null;
    throw error;
  }
}
