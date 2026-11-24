import type { Socket } from "node:net";
import { constants as zlibConstants, gunzipSync, gzipSync } from "node:zlib";

const MEBIBYTE = 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 64 * MEBIBYTE;
const DEFAULT_MAX_MESSAGE_BYTES = 64 * MEBIBYTE;
const DEFAULT_MAX_BUFFERED_WRITE_BYTES = DEFAULT_MAX_LINE_BYTES + 1;
const DEFAULT_MAX_QUEUED_MESSAGES = 1024;
const DEFAULT_MAX_QUEUED_BYTES = 128 * MEBIBYTE;
const DEFAULT_COMPRESSION_THRESHOLD_BYTES = 64 * 1024;

const COMPRESSED_FRAME_MARKER = "$paseoNdjson";
const COMPRESSED_FRAME_VERSION = 1;

interface CompressedNdjsonFrame {
  [COMPRESSED_FRAME_MARKER]: typeof COMPRESSED_FRAME_VERSION;
  encoding: "gzip";
  uncompressedBytes: number;
  data: string;
}

interface QueuedNdjsonMessage<TMessage> {
  message: TMessage;
  decodedBytes: number;
}

export class NdjsonProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NdjsonProtocolError";
  }
}

export class NdjsonBackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NdjsonBackpressureError";
  }
}

export interface NdjsonSocketConnectionOptions<TInbound> {
  /** Maximum wire bytes in one line, excluding the newline delimiter. */
  maxLineBytes?: number;
  /** Maximum UTF-8 JSON bytes before compression or after decompression. */
  maxMessageBytes?: number;
  maxBufferedWriteBytes?: number;
  maxQueuedMessages?: number;
  maxQueuedBytes?: number;
  compressionThresholdBytes?: number;
  parseMessage?: (value: unknown) => TInbound;
}

export type NdjsonMessageListener<TMessage> = (message: TMessage) => void;
export type NdjsonErrorListener = (error: Error) => void;
export type NdjsonCloseListener = (hadError: boolean) => void;

/**
 * A small NDJSON transport over a connected local socket.
 *
 * Large JSON values use a bounded gzip envelope. Messages received before a
 * consumer subscribes are retained, which keeps transport handshakes safe.
 */
export class NdjsonSocketConnection<TInbound = unknown, TOutbound = unknown> {
  readonly socket: Socket;
  private readonly maxLineBytes: number;
  private readonly maxMessageBytes: number;
  private readonly maxBufferedWriteBytes: number;
  private readonly maxQueuedMessages: number;
  private readonly maxQueuedBytes: number;
  private readonly compressionThresholdBytes: number;
  private readonly parseMessage: (value: unknown) => TInbound;
  private readonly messageListeners = new Set<NdjsonMessageListener<TInbound>>();
  private readonly errorListeners = new Set<NdjsonErrorListener>();
  private readonly closeListeners = new Set<NdjsonCloseListener>();
  private readonly queuedMessages: QueuedNdjsonMessage<TInbound>[] = [];
  private queuedMessageBytes = 0;
  private readBuffer = Buffer.alloc(0);
  private closed = false;

  constructor(socket: Socket, options: NdjsonSocketConnectionOptions<TInbound> = {}) {
    this.socket = socket;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    this.maxMessageBytes = options.maxMessageBytes ?? DEFAULT_MAX_MESSAGE_BYTES;
    this.maxBufferedWriteBytes = options.maxBufferedWriteBytes ?? DEFAULT_MAX_BUFFERED_WRITE_BYTES;
    this.maxQueuedMessages = options.maxQueuedMessages ?? DEFAULT_MAX_QUEUED_MESSAGES;
    this.maxQueuedBytes = options.maxQueuedBytes ?? DEFAULT_MAX_QUEUED_BYTES;
    this.compressionThresholdBytes =
      options.compressionThresholdBytes ?? DEFAULT_COMPRESSION_THRESHOLD_BYTES;
    this.parseMessage = options.parseMessage ?? ((value) => value as TInbound);

    socket.setNoDelay(true);
    socket.on("data", (chunk: Buffer | string) => this.handleData(chunk));
    socket.on("error", (error: Error) => this.emitError(error));
    socket.on("close", (hadError: boolean) => {
      if (this.closed) {
        return;
      }
      this.closed = true;
      for (const listener of Array.from(this.closeListeners)) {
        listener(hadError);
      }
      this.messageListeners.clear();
      this.errorListeners.clear();
      this.closeListeners.clear();
      this.queuedMessages.length = 0;
      this.queuedMessageBytes = 0;
      this.readBuffer = Buffer.alloc(0);
    });
  }

  get isClosed(): boolean {
    return this.closed || this.socket.destroyed;
  }

  get bufferedWriteBytes(): number {
    return this.socket.writableLength;
  }

  onMessage(listener: NdjsonMessageListener<TInbound>): () => void {
    this.messageListeners.add(listener);
    while (this.queuedMessages.length > 0 && this.messageListeners.has(listener)) {
      const queued = this.queuedMessages.shift()!;
      this.queuedMessageBytes -= queued.decodedBytes;
      listener(queued.message);
    }
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: NdjsonErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onClose(listener: NdjsonCloseListener): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  nextMessage(timeoutMs: number): Promise<TInbound> {
    if (this.queuedMessages.length > 0) {
      const queued = this.queuedMessages.shift()!;
      this.queuedMessageBytes -= queued.decodedBytes;
      return Promise.resolve(queued.message);
    }
    if (this.isClosed) {
      return Promise.reject(new Error("NDJSON socket is closed"));
    }

    return new Promise<TInbound>((resolve, reject) => {
      let settled = false;
      const finish = (result: { message: TInbound } | { error: Error }) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        unsubscribeMessage();
        unsubscribeError();
        unsubscribeClose();
        if ("message" in result) {
          resolve(result.message);
        } else {
          reject(result.error);
        }
      };
      const unsubscribeMessage = this.onMessage((message) => finish({ message }));
      const unsubscribeError = this.onError((error) => finish({ error }));
      const unsubscribeClose = this.onClose(() =>
        finish({ error: new Error("NDJSON socket closed before a message arrived") }),
      );
      const timeout = setTimeout(
        () =>
          finish({ error: new Error(`Timed out waiting for NDJSON message after ${timeoutMs}ms`) }),
        timeoutMs,
      );
      (timeout as unknown as { unref?: () => void }).unref?.();
    });
  }

  send(message: TOutbound): boolean {
    if (this.isClosed || !this.socket.writable) {
      throw new Error("Cannot write to a closed NDJSON socket");
    }

    const encoded = this.encodeMessage(message);
    this.ensureWriteCapacity(encoded.length);
    return this.socket.write(encoded);
  }

  sendAsync(message: TOutbound): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.isClosed || !this.socket.writable) {
        reject(new Error("Cannot write to a closed NDJSON socket"));
        return;
      }

      let encoded: Buffer;
      try {
        encoded = this.encodeMessage(message);
        this.ensureWriteCapacity(encoded.length);
      } catch (error) {
        reject(error);
        return;
      }

      this.socket.write(encoded, (error?: Error | null) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  end(): void {
    if (!this.isClosed) {
      this.socket.end();
    }
  }

  destroy(error?: Error): void {
    if (!this.socket.destroyed) {
      this.socket.destroy(error);
    }
  }

  private encodeMessage(message: TOutbound): Buffer {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(message);
    } catch (error) {
      throw new NdjsonProtocolError("Failed to serialize NDJSON message", { cause: error });
    }
    if (serialized === undefined) {
      throw new NdjsonProtocolError("NDJSON message is not JSON serializable");
    }

    const raw = Buffer.from(serialized, "utf8");
    if (raw.length > this.maxMessageBytes) {
      throw new NdjsonProtocolError(
        `Serialized NDJSON message is ${raw.length} bytes; limit is ${this.maxMessageBytes}`,
      );
    }

    let wire = raw;
    if (raw.length >= this.compressionThresholdBytes || raw.length > this.maxLineBytes) {
      let compressed: Buffer;
      try {
        compressed = gzipSync(raw, { level: zlibConstants.Z_BEST_SPEED });
      } catch (error) {
        throw new NdjsonProtocolError("Failed to compress NDJSON message", { cause: error });
      }
      const frame: CompressedNdjsonFrame = {
        [COMPRESSED_FRAME_MARKER]: COMPRESSED_FRAME_VERSION,
        encoding: "gzip",
        uncompressedBytes: raw.length,
        data: compressed.toString("base64url"),
      };
      const framed = Buffer.from(JSON.stringify(frame), "utf8");
      if (
        framed.length <= this.maxLineBytes &&
        (raw.length > this.maxLineBytes || framed.length < raw.length)
      ) {
        wire = framed;
      }
    }

    if (wire.length > this.maxLineBytes) {
      throw new NdjsonProtocolError(
        `Encoded NDJSON line is ${wire.length} bytes; limit is ${this.maxLineBytes}`,
      );
    }

    const encoded = Buffer.allocUnsafe(wire.length + 1);
    wire.copy(encoded);
    encoded[wire.length] = 0x0a;
    return encoded;
  }

  private ensureWriteCapacity(bytes: number): void {
    if (this.socket.writableLength + bytes <= this.maxBufferedWriteBytes) {
      return;
    }
    const error = new NdjsonBackpressureError(
      `NDJSON socket write buffer would exceed ${this.maxBufferedWriteBytes} bytes`,
    );
    this.socket.destroy(error);
    throw error;
  }

  private handleData(chunk: Buffer | string): void {
    if (this.isClosed) {
      return;
    }
    const incoming = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.readBuffer =
      this.readBuffer.length === 0
        ? Buffer.from(incoming)
        : Buffer.concat([this.readBuffer, incoming]);

    while (true) {
      const newlineIndex = this.readBuffer.indexOf(0x0a);
      if (newlineIndex === -1) {
        if (this.readBuffer.length > this.maxLineBytes) {
          this.destroy(
            new NdjsonProtocolError(
              `NDJSON line exceeds ${this.maxLineBytes} bytes without a delimiter`,
            ),
          );
        } else if (
          this.readBuffer.byteOffset > 0 &&
          this.readBuffer.length * 2 < this.readBuffer.buffer.byteLength
        ) {
          this.readBuffer = Buffer.from(this.readBuffer);
        }
        return;
      }

      if (newlineIndex > this.maxLineBytes) {
        this.destroy(new NdjsonProtocolError(`NDJSON line exceeds ${this.maxLineBytes} bytes`));
        return;
      }

      let line = this.readBuffer.subarray(0, newlineIndex);
      this.readBuffer = this.readBuffer.subarray(newlineIndex + 1);
      if (line.length > 0 && line[line.length - 1] === 0x0d) {
        line = line.subarray(0, line.length - 1);
      }
      if (line.length === 0) {
        continue;
      }

      try {
        const decoded = this.decodeMessage(line);
        this.emitMessage(decoded.message, decoded.decodedBytes);
      } catch (error) {
        this.destroy(
          error instanceof NdjsonProtocolError
            ? error
            : new NdjsonProtocolError("Received invalid NDJSON message", { cause: error }),
        );
        return;
      }
    }
  }

  private decodeMessage(line: Buffer): QueuedNdjsonMessage<TInbound> {
    let value: unknown;
    try {
      value = JSON.parse(line.toString("utf8"));
    } catch (error) {
      throw new NdjsonProtocolError("Received invalid NDJSON JSON", { cause: error });
    }

    let decodedBytes = line.length;
    if (isRecord(value) && Object.hasOwn(value, COMPRESSED_FRAME_MARKER)) {
      const frame = parseCompressedFrame(value, this.maxMessageBytes);
      const compressed = decodeBase64Url(frame.data);
      let decompressed: Buffer;
      try {
        decompressed = gunzipSync(compressed, { maxOutputLength: frame.uncompressedBytes });
      } catch (error) {
        throw new NdjsonProtocolError("Failed to decompress NDJSON message", { cause: error });
      }
      if (decompressed.length !== frame.uncompressedBytes) {
        throw new NdjsonProtocolError(
          `Decompressed NDJSON message is ${decompressed.length} bytes; expected ${frame.uncompressedBytes}`,
        );
      }
      decodedBytes = decompressed.length;
      try {
        value = JSON.parse(decompressed.toString("utf8"));
      } catch (error) {
        throw new NdjsonProtocolError("Received invalid compressed NDJSON JSON", { cause: error });
      }
    } else if (decodedBytes > this.maxMessageBytes) {
      throw new NdjsonProtocolError(
        `Decoded NDJSON message is ${decodedBytes} bytes; limit is ${this.maxMessageBytes}`,
      );
    }

    return { message: this.parseMessage(value), decodedBytes };
  }

  private emitMessage(message: TInbound, decodedBytes: number): void {
    if (this.messageListeners.size === 0) {
      if (
        this.queuedMessages.length >= this.maxQueuedMessages ||
        this.queuedMessageBytes + decodedBytes > this.maxQueuedBytes
      ) {
        this.destroy(
          new NdjsonProtocolError(
            `NDJSON message queue exceeds ${this.maxQueuedMessages} messages or ${this.maxQueuedBytes} bytes`,
          ),
        );
        return;
      }
      this.queuedMessages.push({ message, decodedBytes });
      this.queuedMessageBytes += decodedBytes;
      return;
    }
    for (const listener of Array.from(this.messageListeners)) {
      listener(message);
    }
  }

  private emitError(error: Error): void {
    for (const listener of Array.from(this.errorListeners)) {
      listener(error);
    }
  }
}

function parseCompressedFrame(
  value: Record<string, unknown>,
  maxMessageBytes: number,
): CompressedNdjsonFrame {
  const keys = Object.keys(value);
  if (
    keys.length !== 4 ||
    value[COMPRESSED_FRAME_MARKER] !== COMPRESSED_FRAME_VERSION ||
    value.encoding !== "gzip" ||
    !Number.isSafeInteger(value.uncompressedBytes) ||
    typeof value.uncompressedBytes !== "number" ||
    value.uncompressedBytes <= 0 ||
    value.uncompressedBytes > maxMessageBytes ||
    typeof value.data !== "string"
  ) {
    throw new NdjsonProtocolError("Received invalid compressed NDJSON frame");
  }
  return value as unknown as CompressedNdjsonFrame;
}

function decodeBase64Url(value: string): Buffer {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new NdjsonProtocolError("Received invalid compressed NDJSON data");
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new NdjsonProtocolError("Received non-canonical compressed NDJSON data");
  }
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
