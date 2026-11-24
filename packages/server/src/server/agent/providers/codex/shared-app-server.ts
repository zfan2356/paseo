import { isAbsolute } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { WebSocket } from "ws";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";

const SOCKET_ENV = "PASEO_CODEX_APP_SERVER_SOCKET";

export interface SharedCodexFeatures {
  goals: boolean;
  autoReview: boolean;
}

export function resolveSharedCodexSocket(
  settings: ProviderRuntimeSettings | undefined,
): string | null {
  const socketPath = settings?.env?.[SOCKET_ENV];
  if (socketPath === undefined) return null;
  if (!isAbsolute(socketPath) || socketPath.includes(":")) {
    throw new Error(`${SOCKET_ENV} must name an absolute Unix socket`);
  }
  if (settings?.command && settings.command.mode !== "default") {
    throw new Error(
      "Shared Codex uses the server's configuration; remove the provider command override",
    );
  }
  const extraKeys = Object.keys(settings?.env ?? {}).filter((key) => key !== SOCKET_ENV);
  if (extraKeys.length > 0) {
    throw new Error(
      `Configure the shared Codex server's environment instead of provider environment overrides: ${extraKeys.join(", ")}`,
    );
  }
  return socketPath;
}

export class CodexAppServerSocket {
  readonly stdout = new PassThrough();
  readonly stdin: Writable;
  private readonly closed: Promise<void>;
  private closeHandler: ((error: Error) => void) | null = null;
  private failure = new Error("Shared Codex app-server connection closed");

  private constructor(private readonly socket: WebSocket) {
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => socket.send(chunk.toString(), callback),
    });
    this.stdin.on("error", (error) => {
      this.failure = error;
      socket.terminate();
    });
    socket.on("message", (data) => {
      if (!this.stdout.write(`${data.toString()}\n`)) socket.pause();
    });
    this.stdout.on("drain", () => socket.resume());
    socket.on("error", (error) => {
      this.failure = error;
    });
    this.closed = new Promise((resolve) => {
      socket.once("close", () => {
        this.stdout.end();
        this.stdin.destroy();
        this.closeHandler?.(this.failure);
        resolve();
      });
    });
  }

  static async connect(socketPath: string): Promise<CodexAppServerSocket> {
    const socket = new WebSocket(`ws+unix://${socketPath}:/`, {
      handshakeTimeout: 5_000,
      // Codex's control socket rejects the extension offer sent by ws by default.
      perMessageDeflate: false,
      headers: { Host: "localhost" },
    });
    const connection = new CodexAppServerSocket(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        socket.off("error", reject);
        resolve();
      });
      socket.once("error", reject);
    });
    return connection;
  }

  onClose(handler: (error: Error) => void): void {
    this.closeHandler = handler;
    if (this.socket.readyState === WebSocket.CLOSED) handler(this.failure);
  }

  async close(): Promise<void> {
    this.closeHandler = null;
    this.socket.close();
    const timer = setTimeout(() => this.socket.terminate(), 1_000);
    try {
      await this.closed;
    } finally {
      clearTimeout(timer);
    }
  }
}
