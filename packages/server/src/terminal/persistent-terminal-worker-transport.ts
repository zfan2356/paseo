import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";
import {
  ensurePrivateDirectory,
  ensurePrivateFile,
  PRIVATE_FILE_MODE,
} from "../server/private-files.js";
import {
  NdjsonSocketConnection,
  type NdjsonSocketConnectionOptions,
} from "./terminal-worker-ndjson.js";
const TERMINAL_WORKER_PROTOCOL_VERSION = 1;

const RUNTIME_DIRECTORY_NAME = "terminal-worker";
const TOKEN_FILE_NAME = "auth-token";
const MAX_SAFE_UNIX_SOCKET_PATH_BYTES = 100;
const DEFAULT_CONNECT_TIMEOUT_MS = 1_000;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 3_000;
const HANDSHAKE_AUTH_DOMAIN = "paseo-terminal-worker-auth-v1";
const HANDSHAKE_RANDOM_BYTES = 32;
const MAX_HANDSHAKE_ID_LENGTH = 256;
const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const TRANSPORT_HELLO_TYPE = "paseo.terminal-worker.transport.hello";
const TRANSPORT_CHALLENGE_TYPE = "paseo.terminal-worker.transport.challenge";
const TRANSPORT_AUTH_TYPE = "paseo.terminal-worker.transport.auth";
const TRANSPORT_READY_TYPE = "paseo.terminal-worker.transport.ready";
const TRANSPORT_REJECT_TYPE = "paseo.terminal-worker.transport.reject";

interface PersistentTerminalWorkerHello {
  type: typeof TRANSPORT_HELLO_TYPE;
  protocolVersion: number;
  clientId: string;
  clientNonce: string;
}

interface PersistentTerminalWorkerChallenge {
  type: typeof TRANSPORT_CHALLENGE_TYPE;
  protocolVersion: number;
  workerId: string;
  serverNonce: string;
  serverProof: string;
}

interface PersistentTerminalWorkerAuth {
  type: typeof TRANSPORT_AUTH_TYPE;
  clientProof: string;
}

interface PersistentTerminalWorkerReady {
  type: typeof TRANSPORT_READY_TYPE;
  protocolVersion: number;
  workerId: string;
}

interface PersistentTerminalWorkerReject {
  type: typeof TRANSPORT_REJECT_TYPE;
  error: string;
}

type PersistentTerminalWorkerClientHandshakeInbound =
  | PersistentTerminalWorkerChallenge
  | PersistentTerminalWorkerReady
  | PersistentTerminalWorkerReject;

type PersistentTerminalWorkerServerHandshakeOutbound =
  | PersistentTerminalWorkerChallenge
  | PersistentTerminalWorkerReady
  | PersistentTerminalWorkerReject;

export interface PersistentTerminalWorkerRuntime {
  paseoHome: string;
  runtimeDirectory: string;
  endpoint: string;
  tokenFile: string;
  authToken: string;
}

export interface PersistentTerminalWorkerConnection<TInbound, TOutbound> {
  clientId: string;
  workerId: string;
  runtime: PersistentTerminalWorkerRuntime;
  transport: NdjsonSocketConnection<TInbound, TOutbound>;
}

export interface ConnectPersistentTerminalWorkerOptions<TInbound> {
  clientId?: string;
  connectTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  ndjson?: NdjsonSocketConnectionOptions<TInbound>;
}

export interface PersistentTerminalWorkerServerConnection<TInbound, TOutbound> {
  clientId: string;
  transport: NdjsonSocketConnection<TInbound, TOutbound>;
}

export interface ListenPersistentTerminalWorkerServerOptions<TInbound, TOutbound> {
  runtime: PersistentTerminalWorkerRuntime;
  workerId?: string;
  handshakeTimeoutMs?: number;
  replaceExistingConnections?: "after-authentication" | "never";
  /** @deprecated Use replaceExistingConnections. */
  singleClient?: boolean;
  ndjson?: NdjsonSocketConnectionOptions<TInbound>;
  onConnectionCountChange?: (connectionCount: number) => void;
  onConnection: (
    connection: PersistentTerminalWorkerServerConnection<TInbound, TOutbound>,
  ) => void | Promise<void>;
}

export interface PersistentTerminalWorkerServer {
  workerId: string;
  endpoint: string;
  server: Server;
  readonly connectionCount: number;
  close(): Promise<void>;
}

export class PersistentTerminalWorkerAuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistentTerminalWorkerAuthenticationError";
  }
}

export class PersistentTerminalWorkerEndpointInUseError extends Error {
  constructor(endpoint: string) {
    super(`Persistent terminal worker endpoint is already in use: ${endpoint}`);
    this.name = "PersistentTerminalWorkerEndpointInUseError";
  }
}

export function resolvePersistentTerminalWorkerRuntime(
  paseoHome: string,
): PersistentTerminalWorkerRuntime {
  const resolvedHome = path.resolve(paseoHome);
  const runtimeDirectory = path.join(resolvedHome, "runtime", RUNTIME_DIRECTORY_NAME);
  ensurePrivateDirectory(runtimeDirectory);

  const tokenFile = path.join(runtimeDirectory, TOKEN_FILE_NAME);
  const endpoint = resolvePersistentTerminalWorkerEndpoint(resolvedHome, runtimeDirectory);
  const endpointDirectory = process.platform === "win32" ? null : path.dirname(endpoint);
  if (endpointDirectory) {
    ensurePrivateDirectory(endpointDirectory);
  }

  return {
    paseoHome: resolvedHome,
    runtimeDirectory,
    endpoint,
    tokenFile,
    authToken: loadOrCreatePersistentTerminalWorkerToken(tokenFile),
  };
}

export async function connectPersistentTerminalWorker<TInbound, TOutbound>(
  runtime: PersistentTerminalWorkerRuntime,
  options: ConnectPersistentTerminalWorkerOptions<TInbound> = {},
): Promise<PersistentTerminalWorkerConnection<TInbound, TOutbound>> {
  const clientId = options.clientId ?? randomUUID();
  validateHandshakeId(clientId, "client id");
  const clientNonce = createHandshakeRandomValue();
  const socket = net.createConnection(runtime.endpoint);
  const rawTransport = new NdjsonSocketConnection<
    PersistentTerminalWorkerClientHandshakeInbound | TInbound,
    PersistentTerminalWorkerHello | PersistentTerminalWorkerAuth | TOutbound
  >(socket, createClientHandshakeNdjsonOptions(options.ndjson));

  try {
    await waitForSocketConnect(socket, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);
    const handshakeDeadline =
      Date.now() + (options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);
    rawTransport.send({
      type: TRANSPORT_HELLO_TYPE,
      protocolVersion: TERMINAL_WORKER_PROTOCOL_VERSION,
      clientId,
      clientNonce,
    });

    const challenge = await rawTransport.nextMessage(handshakeTimeRemaining(handshakeDeadline));
    if (!isPersistentTerminalWorkerChallenge(challenge)) {
      const message = isPersistentTerminalWorkerReject(challenge)
        ? challenge.error
        : "Persistent terminal worker returned an invalid authentication challenge";
      throw new PersistentTerminalWorkerAuthenticationError(message);
    }
    if (challenge.protocolVersion !== TERMINAL_WORKER_PROTOCOL_VERSION) {
      throw new PersistentTerminalWorkerAuthenticationError(
        `Persistent terminal worker protocol mismatch: expected ${TERMINAL_WORKER_PROTOCOL_VERSION}, received ${challenge.protocolVersion}`,
      );
    }
    const expectedServerProof = createHandshakeProof(runtime.authToken, "server", {
      clientId,
      clientNonce,
      workerId: challenge.workerId,
      serverNonce: challenge.serverNonce,
    });
    if (!proofsEqual(challenge.serverProof, expectedServerProof)) {
      throw new PersistentTerminalWorkerAuthenticationError(
        "Persistent terminal worker authentication failed",
      );
    }

    rawTransport.send({
      type: TRANSPORT_AUTH_TYPE,
      clientProof: createHandshakeProof(runtime.authToken, "client", {
        clientId,
        clientNonce,
        workerId: challenge.workerId,
        serverNonce: challenge.serverNonce,
      }),
    });
    const response = await rawTransport.nextMessage(handshakeTimeRemaining(handshakeDeadline));
    if (!isPersistentTerminalWorkerReady(response)) {
      const message = isPersistentTerminalWorkerReject(response)
        ? response.error
        : "Persistent terminal worker returned an invalid handshake response";
      throw new PersistentTerminalWorkerAuthenticationError(message);
    }
    if (
      response.protocolVersion !== TERMINAL_WORKER_PROTOCOL_VERSION ||
      response.workerId !== challenge.workerId
    ) {
      throw new PersistentTerminalWorkerAuthenticationError(
        "Persistent terminal worker returned an inconsistent handshake response",
      );
    }

    return {
      clientId,
      workerId: response.workerId,
      runtime,
      transport: rawTransport as unknown as NdjsonSocketConnection<TInbound, TOutbound>,
    };
  } catch (error) {
    rawTransport.destroy();
    throw error;
  }
}

export async function listenPersistentTerminalWorkerServer<TInbound, TOutbound>(
  options: ListenPersistentTerminalWorkerServerOptions<TInbound, TOutbound>,
): Promise<PersistentTerminalWorkerServer> {
  const { runtime } = options;
  const workerId = options.workerId ?? randomUUID();
  validateHandshakeId(workerId, "worker id");
  const replacementPolicy =
    options.replaceExistingConnections ??
    (options.singleClient === false ? "never" : "after-authentication");
  await prepareEndpointForListen(runtime.endpoint);

  const acceptedSockets = new Set<Socket>();
  const authenticatedConnections = new Set<NdjsonSocketConnection<TInbound, TOutbound>>();
  const server = net.createServer((socket: Socket) => {
    acceptedSockets.add(socket);
    options.onConnectionCountChange?.(acceptedSockets.size);
    socket.once("close", () => {
      acceptedSockets.delete(socket);
      options.onConnectionCountChange?.(acceptedSockets.size);
    });
    void authenticateServerSocket<TInbound, TOutbound>({
      socket,
      runtime,
      workerId,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS,
      ndjson: options.ndjson,
    })
      .then((connection) => {
        if (replacementPolicy === "after-authentication") {
          for (const existing of authenticatedConnections) {
            existing.destroy();
          }
          authenticatedConnections.clear();
        }
        authenticatedConnections.add(connection.transport);
        connection.transport.onClose(() => authenticatedConnections.delete(connection.transport));
        return options.onConnection(connection);
      })
      .catch(() => {
        socket.destroy();
      });
  });

  await listenOnEndpoint(server, runtime.endpoint);
  if (process.platform !== "win32") {
    chmodSync(runtime.endpoint, PRIVATE_FILE_MODE);
  }

  return {
    workerId,
    endpoint: runtime.endpoint,
    server,
    get connectionCount(): number {
      return acceptedSockets.size;
    },
    async close(): Promise<void> {
      for (const socket of acceptedSockets) {
        socket.destroy();
      }
      acceptedSockets.clear();
      for (const connection of authenticatedConnections) {
        connection.destroy();
      }
      authenticatedConnections.clear();
      await closeServer(server);
      if (process.platform !== "win32") {
        rmSync(runtime.endpoint, { force: true });
      }
    },
  };
}

function resolvePersistentTerminalWorkerEndpoint(
  paseoHome: string,
  runtimeDirectory: string,
): string {
  const hash = createHash("sha256").update(paseoHome).digest("hex").slice(0, 24);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\paseo-terminal-worker-v${TERMINAL_WORKER_PROTOCOL_VERSION}-${hash}`;
  }

  const preferred = path.join(runtimeDirectory, `worker-v${TERMINAL_WORKER_PROTOCOL_VERSION}.sock`);
  if (Buffer.byteLength(preferred) <= MAX_SAFE_UNIX_SOCKET_PATH_BYTES) {
    return preferred;
  }

  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const fallback = path.join(
    "/tmp",
    `paseo-tw-${uid}`,
    `${hash}-v${TERMINAL_WORKER_PROTOCOL_VERSION}.sock`,
  );
  const fallbackBytes = Buffer.byteLength(fallback, "utf8");
  if (fallbackBytes > MAX_SAFE_UNIX_SOCKET_PATH_BYTES) {
    throw new Error(
      `Persistent terminal worker socket path is ${fallbackBytes} bytes; limit is ${MAX_SAFE_UNIX_SOCKET_PATH_BYTES}`,
    );
  }
  return fallback;
}

function loadOrCreatePersistentTerminalWorkerToken(tokenFile: string): string {
  ensurePrivateDirectory(path.dirname(tokenFile));
  if (!existsSync(tokenFile)) {
    const token = randomBytes(32).toString("base64url");
    let descriptor: number | null = null;
    try {
      descriptor = openSync(tokenFile, "wx", PRIVATE_FILE_MODE);
      writeFileSync(descriptor, `${token}\n`, "utf8");
    } catch (error) {
      if (!isNodeErrorWithCode(error, "EEXIST")) {
        throw error;
      }
    } finally {
      if (descriptor !== null) {
        closeSync(descriptor);
      }
    }
  }

  ensurePrivateFile(tokenFile);
  const token = readFileSync(tokenFile, "utf8").trim();
  if (!isFixedBase64Url(token)) {
    throw new Error(`Invalid persistent terminal worker token file: ${tokenFile}`);
  }
  return token;
}

async function authenticateServerSocket<TInbound, TOutbound>(input: {
  socket: Socket;
  runtime: PersistentTerminalWorkerRuntime;
  workerId: string;
  handshakeTimeoutMs: number;
  ndjson: ListenPersistentTerminalWorkerServerOptions<TInbound, TOutbound>["ndjson"];
}): Promise<PersistentTerminalWorkerServerConnection<TInbound, TOutbound>> {
  const rawTransport = new NdjsonSocketConnection<
    PersistentTerminalWorkerHello | PersistentTerminalWorkerAuth | TInbound,
    PersistentTerminalWorkerServerHandshakeOutbound | TOutbound
  >(input.socket, createServerHandshakeNdjsonOptions(input.ndjson));
  const handshakeDeadline = Date.now() + input.handshakeTimeoutMs;

  try {
    const hello = await rawTransport.nextMessage(handshakeTimeRemaining(handshakeDeadline));
    if (!isPersistentTerminalWorkerHello(hello)) {
      await rejectHandshake(rawTransport, "Authentication failed");
      throw new PersistentTerminalWorkerAuthenticationError("Invalid terminal worker hello");
    }
    if (hello.protocolVersion !== TERMINAL_WORKER_PROTOCOL_VERSION) {
      await rejectHandshake(
        rawTransport,
        `Unsupported protocol version ${hello.protocolVersion}; expected ${TERMINAL_WORKER_PROTOCOL_VERSION}`,
      );
      throw new PersistentTerminalWorkerAuthenticationError("Terminal worker protocol mismatch");
    }

    const serverNonce = createHandshakeRandomValue();
    await rawTransport.sendAsync({
      type: TRANSPORT_CHALLENGE_TYPE,
      protocolVersion: TERMINAL_WORKER_PROTOCOL_VERSION,
      workerId: input.workerId,
      serverNonce,
      serverProof: createHandshakeProof(input.runtime.authToken, "server", {
        clientId: hello.clientId,
        clientNonce: hello.clientNonce,
        workerId: input.workerId,
        serverNonce,
      }),
    });

    const auth = await rawTransport.nextMessage(handshakeTimeRemaining(handshakeDeadline));
    const expectedClientProof = createHandshakeProof(input.runtime.authToken, "client", {
      clientId: hello.clientId,
      clientNonce: hello.clientNonce,
      workerId: input.workerId,
      serverNonce,
    });
    if (
      !isPersistentTerminalWorkerAuth(auth) ||
      !proofsEqual(auth.clientProof, expectedClientProof)
    ) {
      await rejectHandshake(rawTransport, "Authentication failed");
      throw new PersistentTerminalWorkerAuthenticationError(
        "Terminal worker authentication failed",
      );
    }

    await rawTransport.sendAsync({
      type: TRANSPORT_READY_TYPE,
      protocolVersion: TERMINAL_WORKER_PROTOCOL_VERSION,
      workerId: input.workerId,
    });
    return {
      clientId: hello.clientId,
      transport: rawTransport as unknown as NdjsonSocketConnection<TInbound, TOutbound>,
    };
  } catch (error) {
    rawTransport.destroy();
    throw error;
  }
}

async function rejectHandshake<TInbound, TOutbound>(
  transport: NdjsonSocketConnection<
    TInbound,
    PersistentTerminalWorkerServerHandshakeOutbound | TOutbound
  >,
  error: string,
): Promise<void> {
  await transport.sendAsync({ type: TRANSPORT_REJECT_TYPE, error }).catch(() => undefined);
  transport.destroy();
}

function createClientHandshakeNdjsonOptions<TInbound>(
  options: NdjsonSocketConnectionOptions<TInbound> | undefined,
): NdjsonSocketConnectionOptions<PersistentTerminalWorkerClientHandshakeInbound | TInbound> {
  const { parseMessage, ...framingOptions } = options ?? {};
  return {
    ...framingOptions,
    parseMessage(value) {
      if (
        isPersistentTerminalWorkerChallenge(value) ||
        isPersistentTerminalWorkerReady(value) ||
        isPersistentTerminalWorkerReject(value)
      ) {
        return value;
      }
      return parseMessage ? parseMessage(value) : (value as TInbound);
    },
  };
}

function createServerHandshakeNdjsonOptions<TInbound>(
  options: NdjsonSocketConnectionOptions<TInbound> | undefined,
): NdjsonSocketConnectionOptions<
  PersistentTerminalWorkerHello | PersistentTerminalWorkerAuth | TInbound
> {
  const { parseMessage, ...framingOptions } = options ?? {};
  return {
    ...framingOptions,
    parseMessage(value) {
      if (isPersistentTerminalWorkerHello(value) || isPersistentTerminalWorkerAuth(value)) {
        return value;
      }
      return parseMessage ? parseMessage(value) : (value as TInbound);
    },
  };
}

interface PersistentTerminalWorkerHandshakeTranscript {
  clientId: string;
  clientNonce: string;
  workerId: string;
  serverNonce: string;
}

function createHandshakeProof(
  token: string,
  role: "server" | "client",
  transcript: PersistentTerminalWorkerHandshakeTranscript,
): string {
  const key = decodeFixedBase64Url(token);
  if (!key) {
    throw new Error("Invalid persistent terminal worker authentication token");
  }
  const authenticatedTranscript = JSON.stringify([
    HANDSHAKE_AUTH_DOMAIN,
    role,
    TERMINAL_WORKER_PROTOCOL_VERSION,
    transcript.clientId,
    transcript.clientNonce,
    transcript.workerId,
    transcript.serverNonce,
  ]);
  return createHmac("sha256", key).update(authenticatedTranscript, "utf8").digest("base64url");
}

function createHandshakeRandomValue(): string {
  return randomBytes(HANDSHAKE_RANDOM_BYTES).toString("base64url");
}

function handshakeTimeRemaining(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new PersistentTerminalWorkerAuthenticationError(
      "Persistent terminal worker handshake timed out",
    );
  }
  return remaining;
}

function proofsEqual(provided: string, expected: string): boolean {
  const providedBytes = decodeFixedBase64Url(provided);
  const expectedBytes = decodeFixedBase64Url(expected);
  return Boolean(providedBytes && expectedBytes && timingSafeEqual(providedBytes, expectedBytes));
}

function validateHandshakeId(value: string, description: string): void {
  if (!isValidHandshakeId(value)) {
    throw new Error(
      `Persistent terminal worker ${description} must contain 1-${MAX_HANDSHAKE_ID_LENGTH} characters`,
    );
  }
}

function isValidHandshakeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_HANDSHAKE_ID_LENGTH;
}

function isFixedBase64Url(value: unknown): value is string {
  return decodeFixedBase64Url(value) !== null;
}

function decodeFixedBase64Url(value: unknown): Buffer | null {
  if (typeof value !== "string" || !BASE64URL_32_BYTE_PATTERN.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== HANDSHAKE_RANDOM_BYTES || decoded.toString("base64url") !== value) {
    return null;
  }
  return decoded;
}

function isPersistentTerminalWorkerHello(value: unknown): value is PersistentTerminalWorkerHello {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === TRANSPORT_HELLO_TYPE &&
    typeof value.protocolVersion === "number" &&
    Number.isSafeInteger(value.protocolVersion) &&
    isValidHandshakeId(value.clientId) &&
    isFixedBase64Url(value.clientNonce)
  );
}

function isPersistentTerminalWorkerChallenge(
  value: unknown,
): value is PersistentTerminalWorkerChallenge {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === TRANSPORT_CHALLENGE_TYPE &&
    typeof value.protocolVersion === "number" &&
    Number.isSafeInteger(value.protocolVersion) &&
    isValidHandshakeId(value.workerId) &&
    isFixedBase64Url(value.serverNonce) &&
    isFixedBase64Url(value.serverProof)
  );
}

function isPersistentTerminalWorkerAuth(value: unknown): value is PersistentTerminalWorkerAuth {
  return (
    isRecord(value) && value.type === TRANSPORT_AUTH_TYPE && isFixedBase64Url(value.clientProof)
  );
}

function isPersistentTerminalWorkerReady(value: unknown): value is PersistentTerminalWorkerReady {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.type === TRANSPORT_READY_TYPE &&
    typeof value.protocolVersion === "number" &&
    Number.isSafeInteger(value.protocolVersion) &&
    isValidHandshakeId(value.workerId)
  );
}

function isPersistentTerminalWorkerReject(value: unknown): value is PersistentTerminalWorkerReject {
  return isRecord(value) && value.type === TRANSPORT_REJECT_TYPE && typeof value.error === "string";
}

async function waitForSocketConnect(socket: Socket, timeoutMs: number): Promise<void> {
  if (socket.readyState === "open") {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.off("connect", onConnect);
      socket.off("error", onError);
      socket.off("close", onClose);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve();
      }
    };
    const onConnect = () => finish();
    const onError = (error: Error) => finish(error);
    const onClose = () => finish(new Error("Socket closed before connecting"));
    const timeout = setTimeout(
      () => finish(new Error(`Timed out connecting to terminal worker after ${timeoutMs}ms`)),
      timeoutMs,
    );
    (timeout as unknown as { unref?: () => void }).unref?.();
    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function prepareEndpointForListen(endpoint: string): Promise<void> {
  if (process.platform === "win32" || !existsSync(endpoint)) {
    return;
  }
  const endpointActive = await probeEndpoint(endpoint);
  if (endpointActive) {
    throw new PersistentTerminalWorkerEndpointInUseError(endpoint);
  }
  rmSync(endpoint, { force: true });
}

async function probeEndpoint(endpoint: string): Promise<boolean> {
  const socket = net.createConnection(endpoint);
  const active = await Promise.race([
    new Promise<boolean>((resolve) => socket.once("connect", () => resolve(true))),
    new Promise<boolean>((resolve) => socket.once("error", () => resolve(false))),
    delay(250).then(() => false),
  ]);
  socket.destroy();
  return active;
}

async function listenOnEndpoint(server: Server, endpoint: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(endpoint);
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
