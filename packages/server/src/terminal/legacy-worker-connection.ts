import { EventEmitter } from "node:events";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TerminalStateSchema, type TerminalState } from "@getpaseo/protocol/messages";
import { renderTerminalSnapshotToAnsi } from "@getpaseo/protocol/terminal-snapshot";
import { TERMINAL_REPLAY_CHUNK_BYTES } from "./terminal-replay.js";
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
export type LegacyRequest =
  | Exclude<TerminalWorkerRequest, { type: "replayTerminal" }>
  | LegacyAttachRequest
  | {
      type: "getTerminalState";
      requestId: string;
      terminalId: string;
      options?: { scrollbackLines?: number };
    };
const LegacySnapshotSchema = z.object({
  state: TerminalStateSchema,
  revision: z.number().optional(),
});
type LegacyConnection = PersistentTerminalWorkerConnection<LegacyMessage, LegacyRequest>;
export type LegacyMessage =
  | TerminalWorkerToParentMessage
  | {
      type: "terminalMessage";
      terminalId: string;
      message: { type: "snapshot"; state: TerminalState; revision?: number };
    };

// COMPAT(forkTerminalWorker): added in v0.14.0-beta.2, remove after legacy NDJSON workers drain.
export class LegacyWorkerConnection extends EventEmitter implements TerminalWorkerConnection {
  // The legacy handshake has no PID; this adapter is never passed to the process reaper.
  readonly workerPid = 0;
  private readonly listings = new Map<string, WorkerListedTerminal[]>();
  private readonly replays = new Set<string>();
  private readonly connection: LegacyConnection;

  constructor(connection: LegacyConnection) {
    super();
    this.connection = connection;
    connection.transport.onMessage((message) => {
      if (message.type === "terminalMessage") {
        const event = message.message;
        this.emit("message", {
          ...message,
          replayPreamble: "replayPreamble" in message ? (message.replayPreamble ?? "") : "",
          message:
            event.type === "snapshot" ? { type: "snapshotReady", revision: event.revision } : event,
        });
        return;
      }
      if (message.type === "response" && this.replays.delete(message.requestId)) {
        if (message.ok && message.result) {
          const { state, revision } = LegacySnapshotSchema.parse(message.result);
          const metadata = {
            rows: state.rows,
            cols: state.cols,
            retainedHistoryLines: state.scrollback.length,
            revision: revision ?? 0,
            replayPreamble: "",
          };
          const emitReplay = (event: import("./terminal-replay.js").TerminalReplayEvent) =>
            this.emit("message", { type: "terminalReplay", requestId: message.requestId, event });
          emitReplay({ type: "begin", metadata });
          const data = Buffer.from(renderTerminalSnapshotToAnsi(state));
          for (let offset = 0; offset < data.length; offset += TERMINAL_REPLAY_CHUNK_BYTES) {
            emitReplay({
              type: "data",
              data: data.subarray(offset, offset + TERMINAL_REPLAY_CHUNK_BYTES),
            });
          }
          emitReplay({ type: "end" });
          this.emit("message", { ...message, result: metadata });
        } else {
          this.emit("message", message);
        }
        return;
      }
      if (message.type === "terminalCreated") {
        const snapshot = TerminalStateSchema.parse(message.state);
        const state = {
          rows: snapshot.rows,
          cols: snapshot.cols,
          hasOutput:
            snapshot.scrollback.length > 0 ||
            snapshot.grid.some((row) => row.some((cell) => cell.char.trim().length > 0)),
          ...(snapshot.title ? { title: snapshot.title } : {}),
        };
        for (const listing of this.listings.values()) {
          listing.push({
            terminal: message.terminal,
            state,
            activityToken: message.terminal.activityToken ?? null,
            replayPreamble: "",
          });
        }
        this.emit("message", { ...message, state });
        return;
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
    let request: LegacyRequest;
    if (message.type === "listTerminals") {
      request = { type: "attach", requestId: message.requestId };
    } else if (message.type === "replayTerminal") {
      this.replays.add(message.requestId);
      request = { ...message, type: "getTerminalState" };
    } else {
      request = message;
    }
    if (message.type === "listTerminals") this.listings.set(message.requestId, []);
    try {
      const accepted = this.connection.transport.send(request);
      queueMicrotask(() => callback(null));
      return accepted;
    } catch (error) {
      this.listings.delete(message.requestId);
      this.replays.delete(message.requestId);
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
      await connectPersistentTerminalWorker<LegacyMessage, LegacyRequest>(runtime),
    );
  } catch (error) {
    if (isAbsentEndpoint(error)) return null;
    throw error;
  }
}
