import { afterEach, expect, it } from "vitest";
import { isPlatform } from "../test-utils/platform.js";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePersistentTerminalWorkerRuntime } from "./persistent-terminal-worker-transport.js";
import {
  createWorkerTerminalManager,
  detachWorkerTerminalManager,
} from "./worker-terminal-manager.js";
import type {
  TerminalActivityTransitionEvent,
  TerminalManager,
  TerminalWorkspaceContributionChangedEvent,
} from "./terminal-manager.js";
import {
  resolvePaseoCliBinDir,
  resolvePaseoCliExecutablePath,
  type TerminalSession,
} from "./terminal.js";
import type { TerminalState } from "@getpaseo/protocol/messages";
import type { TerminalActivity } from "@getpaseo/protocol/terminal-activity";
import type {
  TerminalWorkerRequest,
  TerminalWorkerToParentMessage,
} from "./terminal-worker-protocol.js";
import { terminateWithTreeKill } from "../utils/tree-kill.js";
import { AGENT_CONVERSATION_TERMINAL_ENV } from "./agent-hooks/agent-hook-installer.js";

type TerminalRow = TerminalState["grid"][number];

function nodeTerminalCommand(script: string): { command: string; args: string[] } {
  return {
    command: process.execPath,
    args: ["-e", script],
  };
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

function getVisibleText(session: TerminalSession): string {
  return getVisibleTextFromState(session.getState());
}

function rowToText(row: TerminalRow): string {
  return row
    .map((cell) => cell.char)
    .join("")
    .trimEnd();
}

function getVisibleTextFromState(state: TerminalState): string {
  return state.grid.map(rowToText).join("\n");
}

function getRenderedTextFromState(state: TerminalState): string {
  return [...state.scrollback, ...state.grid].map(rowToText).join("\n");
}

function readRenderedTokenIndexesFromState(state: TerminalState): number[] {
  const indexes: number[] = [];
  for (const match of getRenderedTextFromState(state).matchAll(/\[(\d+)\]/g)) {
    const value = match[1];
    if (value !== undefined) {
      indexes.push(Number(value));
    }
  }
  return indexes;
}

function createTerminalState(): TerminalState {
  const blankCell = { char: " " };
  return {
    rows: 1,
    cols: 1,
    grid: [[blankCell]],
    scrollback: [],
    cursor: { row: 0, col: 0 },
  };
}

class FakeTerminalWorker extends EventEmitter {
  connected = true;
  killed = false;
  readonly sentMessages: TerminalWorkerRequest[] = [];

  send(message: TerminalWorkerRequest, callback: (error: Error | null) => void): boolean {
    this.sentMessages.push(message);
    callback(null);
    return true;
  }

  disconnect(): void {
    this.connected = false;
    this.emit("exit", 0, null);
  }

  kill(): boolean {
    this.killed = true;
    this.connected = false;
    this.emit("exit", 0, null);
    return true;
  }

  emitWorkerMessage(message: TerminalWorkerToParentMessage): void {
    this.emit("message", message);
  }
}

let manager: TerminalManager | null = null;
const temporaryDirs: string[] = [];
const terminalSessions: TerminalSession[] = [];

function trackTerminal(session: TerminalSession): TerminalSession {
  terminalSessions.push(session);
  return session;
}

async function removeTemporaryDir(dir: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function isEndpointAcceptingConnections(endpoint: string): Promise<boolean> {
  const socket = createConnection(endpoint);
  const acceptingConnections = await Promise.race([
    new Promise<boolean>((resolve) => socket.once("connect", () => resolve(true))),
    new Promise<boolean>((resolve) => socket.once("error", () => resolve(false))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 250)),
  ]);
  socket.destroy();
  return acceptingConnections;
}

async function cleanupPersistentTerminalWorker(options: {
  root: string;
  paseoHome: string;
  terminalId: string | null;
  manager: TerminalManager | null;
}): Promise<void> {
  const errors: unknown[] = [];
  const endpoint = resolvePersistentTerminalWorkerRuntime(options.paseoHome).endpoint;
  let cleanupManager = options.manager;

  if (!cleanupManager) {
    try {
      cleanupManager = await createWorkerTerminalManager({ paseoHome: options.paseoHome });
    } catch (error) {
      errors.push(error);
    }
  }
  if (cleanupManager && options.terminalId) {
    try {
      await cleanupManager.killTerminalAndWait(options.terminalId, {
        gracefulTimeoutMs: 1000,
        forceTimeoutMs: 500,
      });
    } catch (error) {
      errors.push(error);
    }
  } else if (cleanupManager) {
    cleanupManager.killAll();
  }
  if (cleanupManager) {
    try {
      await detachWorkerTerminalManager(cleanupManager);
    } catch (error) {
      errors.push(error);
    }
  }

  let endpointClosed = false;
  try {
    await waitForCondition(async () => !(await isEndpointAcceptingConnections(endpoint)), 5000);
    endpointClosed = true;
  } catch (error) {
    errors.push(error);
  }
  if (endpointClosed) {
    try {
      await removeTemporaryDir(options.root);
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Persistent terminal worker cleanup failed");
  }
}

afterEach(async () => {
  const sessions = terminalSessions.splice(0);
  await Promise.all(
    sessions.map((session) =>
      session
        .killAndWait({
          gracefulTimeoutMs: 1000,
          forceTimeoutMs: 500,
        })
        .catch(() => {}),
    ),
  );
  manager?.killAll();
  manager = null;
  while (temporaryDirs.length > 0) {
    const dir = temporaryDirs.pop();
    if (dir) {
      await removeTemporaryDir(dir);
    }
  }
});

it("creates a terminal through the worker and streams output", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-output-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      process.stdin.on("data", (chunk) => {
        process.stdout.write("worker-output:" + chunk.toString());
      });
      setInterval(() => {}, 1000);
    `),
    }),
  );
  const messages: string[] = [];
  let snapshots = 0;
  const unsubscribe = session.subscribe((message) => {
    if (message.type === "output") {
      messages.push(message.data);
    }
    if (message.type === "snapshot") {
      snapshots += 1;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const snapshotsBeforeOutput = snapshots;

  session.send({ type: "input", data: "hello\r" });

  await waitForCondition(
    () =>
      messages.join("").includes("worker-output:hello") ||
      getVisibleText(session).includes("worker-output:hello"),
    10000,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  unsubscribe();

  expect(messages.join("") + getVisibleText(session)).toContain("worker-output:hello");
  expect(snapshots).toBe(snapshotsBeforeOutput);
});

it("delivers rapid small writes complete and in order through worker coalescing", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-coalesce-"));
  temporaryDirs.push(cwd);
  const burstGatePath = join(cwd, "burst-ready");
  manager = await createWorkerTerminalManager();
  // The file gate starts the burst after this test subscribes without depending
  // on platform-specific PTY input echo/canonical-mode behavior.
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      env: { PASEO_TERMINAL_BURST_GATE: burstGatePath },
      ...nodeTerminalCommand(`
      const fs = require("node:fs");
      const gatePath = process.env.PASEO_TERMINAL_BURST_GATE;
      const gate = setInterval(() => {
        if (!gatePath || !fs.existsSync(gatePath)) {
          return;
        }
        clearInterval(gate);
        for (let i = 0; i < 500; i++) {
          process.stdout.write("[" + i + "]\\n");
        }
      }, 10);
      setInterval(() => {}, 1000);
    `),
    }),
  );

  const events: Array<{ type: string; data?: string }> = [];
  session.subscribe((message) => {
    if (message.type === "output") {
      events.push({ type: "output", data: message.data });
    } else if (message.type === "snapshot" || message.type === "snapshotReady") {
      events.push({ type: message.type });
    }
  });

  // Let the snapshot subscription settle, then trigger the burst.
  await new Promise((resolve) => setTimeout(resolve, 100));
  writeFileSync(burstGatePath, "go");

  const expected = Array.from({ length: 500 }, (_, index) => index);
  let received: number[] = [];
  await waitForCondition(async () => {
    const snapshot = await manager!.getTerminalState(session.id);
    received = snapshot ? readRenderedTokenIndexesFromState(snapshot.state) : [];
    return expected.every((value, index) => received[index] === value);
  }, 10000);

  expect(received).toEqual(expected);

  await waitForCondition(() => events.some((event) => event.type === "output"), 10000);

  // No snapshot may land after output it should have preceded: every snapshot
  // event must come before the first output event.
  const firstOutputIndex = events.findIndex((event) => event.type === "output");
  expect(firstOutputIndex).toBeGreaterThanOrEqual(0);
  const snapshotAfterOutput = events
    .slice(firstOutputIndex + 1)
    .find((event) => event.type === "snapshot" || event.type === "snapshotReady");
  expect(snapshotAfterOutput).toBeUndefined();
});

it("pulls fresh terminal state from the worker authority", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-state-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      process.stdout.write("worker-state-ready\\n");
      setInterval(() => {}, 1000);
    `),
    }),
  );

  let visibleText = "";
  await waitForCondition(async () => {
    const snapshot = await manager!.getTerminalState(session.id);
    visibleText = snapshot ? getVisibleTextFromState(snapshot.state) : "";
    return visibleText.includes("worker-state-ready");
  }, 10000);

  expect(visibleText).toContain("worker-state-ready");
});

it("reattaches to a live terminal after the daemon-side manager disconnects", async () => {
  const root = mkdtempSync(join(tmpdir(), "persistent-terminal-worker-"));
  const cwd = join(root, "workspace");
  const paseoHome = join(root, ".paseo");
  const gatePath = join(root, "emit-while-detached");
  const ackPath = join(root, "detached-output-ack");
  const tokenPath = join(root, "activity-token");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(paseoHome, { recursive: true });

  let cleanupManager: TerminalManager | null = null;
  let terminalId: string | null = null;
  try {
    const firstManager = await createWorkerTerminalManager({ paseoHome });
    cleanupManager = firstManager;
    const firstSession = await firstManager.createTerminal({
      workspaceId: "ws-persistent",
      linkedAgentId: "agent-persistent",
      cwd,
      env: {
        PASEO_RESTART_GATE: gatePath,
        PASEO_RESTART_ACK: ackPath,
        PASEO_RESTART_TOKEN_FILE: tokenPath,
      },
      ...nodeTerminalCommand(`
        const fs = require("node:fs");
        const pid = process.pid;
        fs.writeFileSync(process.env.PASEO_RESTART_TOKEN_FILE, process.env.PASEO_ACTIVITY_TOKEN);
        process.stdout.write("READY:" + pid + "\\n");
        const gate = setInterval(() => {
          if (!fs.existsSync(process.env.PASEO_RESTART_GATE)) return;
          clearInterval(gate);
          process.stdout.write("DURING:" + pid + "\\n");
          fs.writeFileSync(process.env.PASEO_RESTART_ACK, String(pid));
        }, 10);
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (data) => {
          if (data.includes("a")) process.stdout.write("AFTER:" + pid + "\\n");
        });
        setInterval(() => {}, 1000);
      `),
    });
    terminalId = firstSession.id;

    let beforeRestart = "";
    await waitForCondition(async () => {
      const snapshot = await firstManager.getTerminalState(firstSession.id);
      beforeRestart = snapshot ? getRenderedTextFromState(snapshot.state) : "";
      return beforeRestart.includes("READY:") && existsSync(tokenPath);
    }, 10000);
    const pid = beforeRestart.match(/READY:(\d+)/)?.[1];
    expect(pid).toEqual(expect.stringMatching(/^\d+$/));
    expect(firstManager.setTerminalTitle(firstSession.id, "Persistent shell")).toBe(true);
    await firstManager.getTerminalState(firstSession.id);

    await detachWorkerTerminalManager(firstManager);
    cleanupManager = null;
    writeFileSync(gatePath, "go");
    await waitForCondition(() => existsSync(ackPath), 10000);
    expect(readFileSync(ackPath, "utf8")).toBe(pid);

    const secondManager = await createWorkerTerminalManager({ paseoHome });
    cleanupManager = secondManager;
    const restored = secondManager.getTerminal(firstSession.id);
    expect(restored).toBeDefined();
    expect(restored?.linkedAgentId).toBe("agent-persistent");
    expect(restored?.getTitle()).toBe("Persistent shell");
    expect((await secondManager.getTerminals(cwd)).map((terminal) => terminal.id)).toEqual([
      firstSession.id,
    ]);
    expect(
      secondManager.validateTerminalActivityToken(firstSession.id, readFileSync(tokenPath, "utf8")),
    ).toBe("valid");

    const restoredSnapshot = await secondManager.getTerminalState(firstSession.id);
    const restoredText = restoredSnapshot ? getRenderedTextFromState(restoredSnapshot.state) : "";
    expect(restoredText).toContain(`READY:${pid}`);
    expect(restoredText).toContain(`DURING:${pid}`);

    restored?.send({ type: "input", data: "a\r" });
    await waitForCondition(async () => {
      const snapshot = await secondManager.getTerminalState(firstSession.id);
      return snapshot ? getRenderedTextFromState(snapshot.state).includes(`AFTER:${pid}`) : false;
    }, 10000);
  } finally {
    await cleanupPersistentTerminalWorker({ root, paseoHome, terminalId, manager: cleanupManager });
  }
});

it("keeps the existing manager attached while a replacement manager starts", async () => {
  const root = mkdtempSync(join(tmpdir(), "persistent-terminal-worker-overlap-"));
  const cwd = join(root, "workspace");
  const paseoHome = join(root, ".paseo");
  const afterPath = join(root, "first-manager-after-overlap");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(paseoHome, { recursive: true });

  let firstManager: TerminalManager | null = null;
  let cleanupManager: TerminalManager | null = null;
  let terminalId: string | null = null;
  try {
    firstManager = await createWorkerTerminalManager({ paseoHome });
    cleanupManager = firstManager;
    const firstSession = await firstManager.createTerminal({
      workspaceId: "ws-overlap",
      cwd,
      ...nodeTerminalCommand(`
        const fs = require("node:fs");
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (data) => {
          if (data.includes("a")) fs.writeFileSync(${JSON.stringify(afterPath)}, "ok");
        });
        setInterval(() => {}, 1000);
      `),
    });
    terminalId = firstSession.id;

    const secondManager = await createWorkerTerminalManager({ paseoHome });
    cleanupManager = secondManager;
    expect(secondManager.getTerminal(firstSession.id)).toBeDefined();
    await expect(firstManager.getTerminalState(firstSession.id)).resolves.not.toBeNull();

    await detachWorkerTerminalManager(secondManager);
    cleanupManager = firstManager;
    await expect(firstManager.getTerminalState(firstSession.id)).resolves.not.toBeNull();

    firstSession.send({ type: "input", data: "a\r" });
    await waitForCondition(() => existsSync(afterPath), 10000);
  } finally {
    if (firstManager && firstManager !== cleanupManager) {
      await detachWorkerTerminalManager(firstManager).catch(() => undefined);
    }
    await cleanupPersistentTerminalWorker({ root, paseoHome, terminalId, manager: cleanupManager });
  }
});

it("recovers immediately from a fresh spawn lock whose owner exited", async () => {
  const root = mkdtempSync(join(tmpdir(), "persistent-terminal-worker-dead-lock-"));
  const paseoHome = join(root, ".paseo");
  mkdirSync(paseoHome, { recursive: true });
  const runtime = resolvePersistentTerminalWorkerRuntime(paseoHome);
  writeFileSync(
    runtime.spawnLockFile,
    `${JSON.stringify({ pid: 2_000_000_000, createdAt: new Date().toISOString() })}\n`,
  );

  let cleanupManager: TerminalManager | null = null;
  try {
    cleanupManager = await createWorkerTerminalManager({
      paseoHome,
      persistentStartupTimeoutMs: 3000,
    });
    expect(cleanupManager.listDirectories()).toEqual([]);
  } finally {
    await cleanupPersistentTerminalWorker({
      root,
      paseoHome,
      terminalId: null,
      manager: cleanupManager,
    });
  }
});

it("reattaches to a live terminal after the daemon process tree is force-stopped", async () => {
  const root = mkdtempSync(join(tmpdir(), "persistent-terminal-worker-tree-kill-"));
  const cwd = join(root, "workspace");
  const paseoHome = join(root, ".paseo");
  const readyPath = join(root, "owner-ready.json");
  const terminalPidPath = join(root, "terminal.pid");
  const afterPath = join(root, "terminal-after-tree-kill");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(paseoHome, { recursive: true });

  const workerManagerUrl = new URL("./worker-terminal-manager.ts", import.meta.url).href;
  const loaderUrl = new URL("./terminal-ts-loader.mjs", import.meta.url).href;
  const loaderImport = [
    'import { register } from "node:module";',
    'import { pathToFileURL } from "node:url";',
    `register(${JSON.stringify(loaderUrl)}, pathToFileURL("./"));`,
  ].join(" ");
  const terminalScript = `
    const fs = require("node:fs");
    const pid = process.pid;
    fs.writeFileSync(${JSON.stringify(terminalPidPath)}, String(pid));
    process.stdout.write("READY:" + pid + "\\n");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data) => {
      if (!data.includes("a")) return;
      fs.writeFileSync(${JSON.stringify(afterPath)}, String(pid));
      process.stdout.write("AFTER:" + pid + "\\n");
    });
    setInterval(() => {}, 1000);
  `;
  const ownerScript = `
    import { existsSync, readFileSync, writeFileSync } from "node:fs";
    import { createWorkerTerminalManager } from ${JSON.stringify(workerManagerUrl)};

    const manager = await createWorkerTerminalManager({ paseoHome: ${JSON.stringify(paseoHome)} });
    const terminal = await manager.createTerminal({
      workspaceId: "ws-tree-kill",
      cwd: ${JSON.stringify(cwd)},
      command: ${JSON.stringify(process.execPath)},
      args: ["-e", ${JSON.stringify(terminalScript)}],
    });
    const deadline = Date.now() + 10000;
    while (!existsSync(${JSON.stringify(terminalPidPath)})) {
      if (Date.now() >= deadline) throw new Error("terminal pid was not written");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    writeFileSync(
      ${JSON.stringify(readyPath)},
      JSON.stringify({
        terminalId: terminal.id,
        pid: readFileSync(${JSON.stringify(terminalPidPath)}, "utf8"),
      }),
    );
    setInterval(() => {}, 1000);
  `;

  let owner: ChildProcess | null = null;
  let ownerStderr = "";
  let cleanupManager: TerminalManager | null = null;
  let terminalId: string | null = null;
  try {
    owner = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        "--import",
        `data:text/javascript,${encodeURIComponent(loaderImport)}`,
        "--input-type=module",
        "-e",
        ownerScript,
      ],
      { cwd: root, stdio: ["ignore", "ignore", "pipe"] },
    );
    owner.stderr?.setEncoding("utf8");
    owner.stderr?.on("data", (chunk: string) => {
      ownerStderr += chunk;
    });

    await waitForCondition(() => {
      if (owner?.exitCode !== null) {
        throw new Error(`terminal owner exited before ready: ${ownerStderr}`);
      }
      return existsSync(readyPath);
    }, 15000);
    const ready = JSON.parse(readFileSync(readyPath, "utf8")) as {
      terminalId: string;
      pid: string;
    };
    terminalId = ready.terminalId;
    expect(ready.pid).toEqual(expect.stringMatching(/^\d+$/));

    const termination = await terminateWithTreeKill(owner, {
      gracefulTimeoutMs: 1000,
      forceTimeoutMs: 2000,
    });
    expect(["terminated", "killed"]).toContain(termination);
    expect(owner.exitCode !== null || owner.signalCode !== null).toBe(true);
    owner = null;

    const secondManager = await createWorkerTerminalManager({ paseoHome });
    cleanupManager = secondManager;
    const restored = secondManager.getTerminal(terminalId);
    expect(restored).toBeDefined();
    expect((await secondManager.getTerminals(cwd)).map((terminal) => terminal.id)).toEqual([
      terminalId,
    ]);

    restored?.send({ type: "input", data: "a\r" });
    await waitForCondition(() => existsSync(afterPath), 10000);
    expect(readFileSync(afterPath, "utf8")).toBe(ready.pid);
  } finally {
    if (owner && owner.exitCode === null && owner.signalCode === null) {
      await terminateWithTreeKill(owner, {
        gracefulTimeoutMs: 500,
        forceTimeoutMs: 1000,
      }).catch(() => undefined);
    }
    await cleanupPersistentTerminalWorker({ root, paseoHome, terminalId, manager: cleanupManager });
  }
}, 30000);

it("reattaches a terminal whose serialized headless state exceeds 16 MiB", async () => {
  const root = mkdtempSync(join(tmpdir(), "persistent-terminal-worker-large-state-"));
  const cwd = join(root, "workspace");
  const paseoHome = join(root, ".paseo");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(paseoHome, { recursive: true });

  const rows = 384;
  const cols = 512;
  const minimumStateBytes = 16 * 1024 * 1024;
  const maximumStateBytes = 64 * 1024 * 1024;
  let cleanupManager: TerminalManager | null = null;
  let terminalId: string | null = null;
  try {
    const firstManager = await createWorkerTerminalManager({
      paseoHome,
      requestTimeoutMs: 30000,
    });
    cleanupManager = firstManager;
    const firstSession = await firstManager.createTerminal({
      workspaceId: "ws-persistent-large-state",
      cwd,
      rows: 24,
      cols: 80,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    });
    terminalId = firstSession.id;

    firstSession.send({ type: "resize", rows, cols });
    const beforeDetach = await firstManager.getTerminalState(firstSession.id);
    if (!beforeDetach) {
      throw new Error("Persistent terminal state was unavailable before detach");
    }
    const beforeDetachBytes = Buffer.byteLength(JSON.stringify(beforeDetach.state));
    expect(beforeDetach.state.rows).toBe(rows);
    expect(beforeDetach.state.cols).toBe(cols);
    expect(beforeDetachBytes).toBeGreaterThan(minimumStateBytes);
    expect(beforeDetachBytes).toBeLessThan(maximumStateBytes);

    await detachWorkerTerminalManager(firstManager);
    cleanupManager = null;

    const secondManager = await createWorkerTerminalManager({
      paseoHome,
      requestTimeoutMs: 30000,
    });
    cleanupManager = secondManager;
    const restored = secondManager.getTerminal(firstSession.id);
    if (!restored) {
      throw new Error("Persistent terminal was not restored after reattach");
    }
    const restoredState = restored.getState();
    const restoredBytes = Buffer.byteLength(JSON.stringify(restoredState));
    expect(restoredState.rows).toBe(rows);
    expect(restoredState.cols).toBe(cols);
    expect(restoredBytes).toBeGreaterThan(minimumStateBytes);
    expect(restoredBytes).toBeLessThan(maximumStateBytes);
  } finally {
    await cleanupPersistentTerminalWorker({
      root,
      paseoHome,
      terminalId,
      manager: cleanupManager,
    });
  }
}, 60000);

// Windows ConPTY normalizes away the kitty keyboard escape the child writes, so it
// never reaches the worker's input-mode tracker and the preamble stays empty. The
// preamble-caching contract is verified on Linux/macOS; the daemon's input-mode
// handling runs identically on every platform once the escape is observed.
it.skipIf(isPlatform("win32"))(
  "caches the input-mode replay preamble from the worker after getTerminalState",
  async () => {
    const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-preamble-"));
    temporaryDirs.push(cwd);
    manager = await createWorkerTerminalManager();
    // \x1b[>1u pushes kitty keyboard flag 1, which the worker's input-mode
    // tracker records and reflects in its replay preamble (\x1b[=1;1u).
    const session = trackTerminal(
      await manager.createTerminal({
        workspaceId: "ws-test",
        cwd,
        ...nodeTerminalCommand(`
      process.stdout.write("\\u001b[>1u");
      setInterval(() => {}, 1000);
    `),
      }),
    );

    await waitForCondition(async () => {
      const snapshot = await manager!.getTerminalState(session.id);
      return snapshot !== null && session.getReplayPreamble() === "\x1b[=1;1u";
    }, 10000);

    expect(session.getReplayPreamble()).toBe("\x1b[=1;1u");
  },
);

it("refreshes cached terminal title after worker title changes", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-title-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      process.stdout.write("\\u001b]0;Build Output\\u0007");
      setTimeout(() => {}, 2000);
    `),
    }),
  );

  await waitForCondition(() => session.getTitle() === "Build Output", 10000);

  expect(session.getState().title).toBe("Build Output");
});

it("refreshes cached terminal size after worker resize", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-resize-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(await manager.createTerminal({ cwd, workspaceId: "ws-test" }));

  session.send({ type: "resize", rows: 10, cols: 40 });
  const snapshot = await manager.getTerminalState(session.id);

  expect(snapshot?.state.rows).toBe(10);
  expect(snapshot?.state.cols).toBe(40);
  expect(session.getState().rows).toBe(10);
  expect(session.getState().cols).toBe(40);
});

it("captures terminal output from the worker authority", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-capture-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(await manager.createTerminal({ cwd, workspaceId: "ws-test" }));

  session.send({ type: "input", data: "echo hello world\r" });

  let capture = await manager.captureTerminal(session.id);
  await waitForCondition(async () => {
    capture = await manager!.captureTerminal(session.id);
    return capture.lines.join("\n").includes("hello world");
  }, 10000);

  expect(capture.lines.join("\n")).toContain("hello world");
  expect(capture.totalLines).toBeGreaterThan(0);
});

it("does not surface fire-and-forget send timeouts as unhandled rejections", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-1",
      name: "Terminal",
      cwd: "/tmp",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });
  const session = manager.getTerminal("terminal-1");
  expect(session).toBeDefined();

  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  try {
    session?.send({ type: "input", data: "x" });
    await new Promise((resolve) => setTimeout(resolve, 25));
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }

  expect(worker.sentMessages.some((message) => message.type === "send")).toBe(true);
  expect(unhandledRejections).toEqual([]);
});

it("keeps registered cwd env inheritance behind the worker manager interface", async () => {
  manager = await createWorkerTerminalManager();
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-env-"));
  temporaryDirs.push(cwd);
  const markerPath = join(cwd, "env.txt");

  manager.registerCwdEnv({
    cwd,
    env: { PASEO_WORKER_TERMINAL_TEST: "worker-env" },
  });
  trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
      require("node:fs").writeFileSync(
        ${JSON.stringify(markerPath)},
        process.env.PASEO_WORKER_TERMINAL_TEST ?? "",
      );
      setInterval(() => {}, 1000);
    `),
    }),
  );

  await waitForCondition(() => existsSync(markerPath), 10000);

  expect(readFileSync(markerPath, "utf8")).toBe("worker-env");
});

it("injects parent-minted terminal activity env through the worker", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-activity-env-"));
  temporaryDirs.push(cwd);
  const envPath = join(cwd, "activity-env.json");
  const activityUrl = "http://127.0.0.1:12345/api/terminal-activity";
  manager = await createWorkerTerminalManager({
    getTerminalActivityUrl: () => activityUrl,
  });

  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand(`
        require("node:fs").writeFileSync(
          ${JSON.stringify(envPath)},
          JSON.stringify({
            terminalId: process.env.PASEO_TERMINAL_ID,
            token: process.env.PASEO_ACTIVITY_TOKEN,
            url: process.env.PASEO_TERMINAL_ACTIVITY_URL,
            hookCli: process.env.PASEO_HOOK_CLI,
            path: process.env.PATH ?? process.env.Path,
          }),
        );
        setInterval(() => {}, 1000);
      `),
    }),
  );

  await waitForCondition(() => existsSync(envPath), 10000);

  const env = JSON.parse(readFileSync(envPath, "utf8")) as {
    terminalId?: string;
    token?: string;
    url?: string;
    hookCli?: string;
    path?: string;
  };
  const paseoCliBinDir = resolvePaseoCliBinDir();
  const paseoCliPath = resolvePaseoCliExecutablePath();
  expect(paseoCliBinDir).not.toBeNull();
  expect(paseoCliPath).not.toBeNull();
  expect(env.terminalId).toBe(session.id);
  expect(env.token).toEqual(expect.any(String));
  expect(env.token).not.toBe("");
  expect(env.url).toBe(activityUrl);
  expect(env.hookCli).toBe(paseoCliPath);
  expect(manager.validateTerminalActivityToken(session.id, env.token ?? "")).toBe("valid");
  await expect(manager.setTerminalActivity(session.id, "attention")).resolves.toBe(true);
  expect(env.path?.split(delimiter)[0]).toBe(paseoCliBinDir);
});

it("starts the default shell through the worker and accepts quoted commands", async () => {
  manager = await createWorkerTerminalManager();
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-shell-"));
  temporaryDirs.push(cwd);
  const markerPath = join(cwd, "shell quoted marker.txt");
  const session = trackTerminal(
    await manager.createTerminal({ cwd, workspaceId: "ws-test", env: { HOME: cwd } }),
  );
  const command = [
    "node",
    "-e",
    `"require('node:fs').writeFileSync('shell quoted marker.txt','shell-ok')"`,
  ].join(" ");

  session.send({ type: "input", data: `${command}\r` });

  await waitForCondition(() => existsSync(markerPath), 10000);

  expect(readFileSync(markerPath, "utf8")).toBe("shell-ok");
});

it("lists subdirectory terminals when querying the workspace root", async () => {
  const rootCwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-subdir-root-"));
  const subdirCwd = join(rootCwd, "apps", "mobile");
  mkdirSync(subdirCwd, { recursive: true });
  temporaryDirs.push(rootCwd);
  manager = await createWorkerTerminalManager();
  const created = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd: subdirCwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  const rootTerminals = await manager.getTerminals(rootCwd);

  expect(rootTerminals.map((terminal) => terminal.id)).toEqual([created.id]);
});

it("lists terminals locally without waiting on the worker", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-root",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-subdir",
      name: "Shell",
      cwd: "/workspace/apps/mobile",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });

  // The fake worker never answers requests, so a round-trip would reject at the
  // 5ms timeout. A local mirror read must resolve regardless.
  const terminals = await manager.getTerminals("/workspace");

  expect(terminals.map((terminal) => terminal.id).sort()).toEqual([
    "terminal-root",
    "terminal-subdir",
  ]);
  expect(worker.sentMessages.some((message) => message.type === "getTerminals")).toBe(false);
});

it("sends the conversation hook gate through the version-one worker env", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 1000,
    forkWorker: () => worker,
  });

  const creating = manager.createTerminal({
    cwd: "/workspace",
    workspaceId: "ws-test",
    linkedAgentId: "agent-1",
    env: { EXISTING_ENV: "kept" },
  });
  const request = worker.sentMessages.find((message) => message.type === "createTerminal");
  expect(request).toMatchObject({
    type: "createTerminal",
    options: {
      linkedAgentId: "agent-1",
      env: {
        EXISTING_ENV: "kept",
        [AGENT_CONVERSATION_TERMINAL_ENV]: "1",
      },
    },
  });
  if (!request || request.type !== "createTerminal") {
    throw new Error("createTerminal request not sent");
  }
  worker.emitWorkerMessage({
    type: "response",
    requestId: request.requestId,
    ok: true,
    result: {
      terminal: {
        id: request.options.id!,
        name: "Conversation",
        cwd: "/workspace",
        workspaceId: "ws-test",
        linkedAgentId: "agent-1",
        activity: null,
      },
      state: createTerminalState(),
    },
  });

  await expect(creating).resolves.toMatchObject({ linkedAgentId: "agent-1" });
});

it("includes only stamped terminals in workspace-scoped local reads", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-legacy",
      name: "Legacy",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-owned",
      name: "Owned",
      cwd: "/workspace",
      workspaceId: "ws-owned",
      activity: null,
    },
    state: createTerminalState(),
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-sibling",
      name: "Sibling",
      cwd: "/workspace",
      workspaceId: "ws-sibling",
      activity: null,
    },
    state: createTerminalState(),
  });

  const scoped = await manager.getTerminals("/workspace", { workspaceId: "ws-owned" });
  const unscoped = await manager.getTerminals("/workspace");

  expect(scoped.map((terminal) => terminal.id)).toEqual(["terminal-owned"]);
  expect(unscoped.map((terminal) => terminal.id)).toEqual([
    "terminal-legacy",
    "terminal-owned",
    "terminal-sibling",
  ]);
});

it("rejects non-absolute cwd in getTerminals", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 5,
    forkWorker: () => worker,
  });

  await expect(manager.getTerminals("relative/path")).rejects.toThrow("cwd must be absolute path");
});

it("surfaces worker activity changes via getActivity, onActivityChange, and terminalsChanged", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: { state: "idle", changedAt: 0 },
    },
    state: createTerminalState(),
  });

  const session = manager.getTerminal("terminal-a");
  expect(session).toBeDefined();
  expect(session!.getActivity()).toEqual({ state: "idle", changedAt: 0 });

  const activityChanges: Array<{
    activity: TerminalActivity | null;
    previous: TerminalActivity | null;
  }> = [];
  const activityTransitions: TerminalActivityTransitionEvent[] = [];
  const terminalsChangedCwds: string[] = [];
  session!.onActivityChange((transition) => {
    activityChanges.push(transition);
  });
  manager.subscribeTerminalActivity((event) => {
    activityTransitions.push(event);
  });
  manager.subscribeTerminalsChanged((event) => {
    terminalsChangedCwds.push(event.cwd);
  });

  const workingActivity = { state: "working" as const, changedAt: 1000 };
  const idleActivity = { state: "idle" as const, changedAt: 0 };
  worker.emitWorkerMessage({
    type: "terminalActivityChange",
    terminalId: "terminal-a",
    activity: workingActivity,
    previous: idleActivity,
  });

  expect(session!.getActivity()).toEqual(workingActivity);
  expect(activityChanges).toEqual([{ activity: workingActivity, previous: idleActivity }]);
  expect(activityTransitions).toEqual([
    {
      terminalId: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: workingActivity,
      previous: idleActivity,
    },
  ]);
  expect(terminalsChangedCwds).toContain("/workspace");
});

it("sets terminal activity through a worker request", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });

  const result = manager.setTerminalActivity("terminal-a", "attention");
  const request = worker.sentMessages.find((message) => message.type === "setActivity");
  expect(request).toMatchObject({
    type: "setActivity",
    terminalId: "terminal-a",
    state: "attention",
  });
  if (!request) {
    throw new Error("setActivity request not sent");
  }
  worker.emitWorkerMessage({ type: "response", requestId: request.requestId, ok: true });

  await expect(result).resolves.toBe(true);
});

it("clears terminal attention through a worker request", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });
  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: { state: "idle", attentionReason: "finished", changedAt: 1000 },
    },
    state: createTerminalState(),
  });

  const result = manager.clearTerminalAttention("terminal-a");
  const request = worker.sentMessages.find((message) => message.type === "clearAttention");
  expect(request).toMatchObject({
    type: "clearAttention",
    terminalId: "terminal-a",
  });
  if (!request) {
    throw new Error("attention clear request not sent");
  }
  worker.emitWorkerMessage({ type: "response", requestId: request.requestId, ok: true });

  await expect(result).resolves.toBe(true);
});

it("clears finished attention on a real terminal", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-attention-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  // A working -> idle transition is how the real tracker records a "finished"
  // attention: { state: "idle", attentionReason: "finished" }. The state is
  // never literally "attention", so a clear that checks state === "attention"
  // would never fire — the bug this reproduces.
  await manager.setTerminalActivity(session.id, "working");
  await manager.setTerminalActivity(session.id, "idle");
  await waitForCondition(
    () => manager?.getTerminal(session.id)?.getActivity()?.attentionReason === "finished",
    5000,
  );

  const cleared = await manager.clearTerminalAttention(session.id);

  expect(cleared).toBe(true);
  await waitForCondition(
    () => manager?.getTerminal(session.id)?.getActivity()?.attentionReason == null,
    5000,
  );
  expect(manager.getTerminal(session.id)?.getActivity()).toEqual({
    state: "idle",
    changedAt: expect.any(Number),
  });
});

it("removes worker terminals after killAndWait", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-kill-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  await manager.killTerminalAndWait(session.id, {
    gracefulTimeoutMs: 1000,
    forceTimeoutMs: 500,
  });
  terminalSessions.splice(terminalSessions.indexOf(session), 1);

  await waitForCondition(() => manager?.getTerminal(session.id) === undefined, 5000);

  expect(manager.getTerminal(session.id)).toBeUndefined();
  expect(manager.listDirectories()).not.toContain(cwd);
});

it("removes worker terminals after a best-effort kill", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "worker-terminal-manager-kill-best-effort-"));
  temporaryDirs.push(cwd);
  manager = await createWorkerTerminalManager();
  const session = trackTerminal(
    await manager.createTerminal({
      workspaceId: "ws-test",
      cwd,
      ...nodeTerminalCommand("setInterval(() => {}, 1000);"),
    }),
  );

  manager.killTerminal(session.id);
  terminalSessions.splice(terminalSessions.indexOf(session), 1);

  await waitForCondition(() => manager?.getTerminal(session.id) === undefined, 5000);

  expect(manager.getTerminal(session.id)).toBeUndefined();
  expect(manager.listDirectories()).not.toContain(cwd);
});

it("produces one terminals-changed snapshot per title change", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });

  const snapshots: Array<{ cwd: string; terminalIds: string[] }> = [];
  manager.subscribeTerminalsChanged((event) => {
    snapshots.push({ cwd: event.cwd, terminalIds: event.terminals.map((t) => t.id) });
  });

  worker.emitWorkerMessage({
    type: "terminalTitleChange",
    terminalId: "terminal-a",
    title: "Updated",
  });

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toEqual({
    cwd: "/workspace",
    terminalIds: ["terminal-a"],
  });
});

it("produces one terminals-changed snapshot and one contribution event per activity change", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: null,
    },
    state: createTerminalState(),
  });

  const snapshots: Array<{ cwd: string; terminalIds: string[] }> = [];
  manager.subscribeTerminalsChanged((event) => {
    snapshots.push({ cwd: event.cwd, terminalIds: event.terminals.map((t) => t.id) });
  });
  const contributions: TerminalWorkspaceContributionChangedEvent[] = [];
  manager.subscribeTerminalWorkspaceContributionChanged((event) => {
    contributions.push(event);
  });

  const workingActivity = { state: "working" as const, changedAt: 1000 };
  worker.emitWorkerMessage({
    type: "terminalActivityChange",
    terminalId: "terminal-a",
    activity: workingActivity,
    previous: null,
  });

  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toEqual({
    cwd: "/workspace",
    terminalIds: ["terminal-a"],
  });
  expect(contributions).toEqual([
    {
      terminalId: "terminal-a",
      cwd: "/workspace",
      workspaceId: "ws-test",
    },
  ]);
});

it("removes a killed worker terminal from terminalExit without duplicate snapshots", async () => {
  const worker = new FakeTerminalWorker();
  manager = await createWorkerTerminalManager({
    requestTimeoutMs: 50,
    forkWorker: () => worker,
  });
  const workingActivity = { state: "working" as const, changedAt: 1000 };

  worker.emitWorkerMessage({
    type: "terminalCreated",
    terminal: {
      id: "terminal-a",
      name: "Shell",
      cwd: "/workspace",
      workspaceId: "ws-test",
      activity: workingActivity,
    },
    state: createTerminalState(),
  });

  const snapshots: Array<{ cwd: string; terminalIds: string[] }> = [];
  manager.subscribeTerminalsChanged((event) => {
    snapshots.push({ cwd: event.cwd, terminalIds: event.terminals.map((terminal) => terminal.id) });
  });
  const contributions: TerminalWorkspaceContributionChangedEvent[] = [];
  manager.subscribeTerminalWorkspaceContributionChanged((event) => {
    contributions.push(event);
  });

  manager.killTerminal("terminal-a");
  const request = worker.sentMessages.find(
    (message) => message.type === "killTerminal" && message.terminalId === "terminal-a",
  );
  if (!request) {
    throw new Error("killTerminal request not sent");
  }
  worker.emitWorkerMessage({ type: "response", requestId: request.requestId, ok: true });

  worker.emitWorkerMessage({
    type: "terminalExit",
    terminalId: "terminal-a",
    info: {
      exitCode: null,
      signal: null,
      lastOutputLines: [],
    },
  });

  expect(manager.getTerminal("terminal-a")).toBeUndefined();
  expect(snapshots).toEqual([{ cwd: "/workspace", terminalIds: [] }]);
  expect(contributions).toEqual([
    {
      terminalId: "terminal-a",
      cwd: "/workspace",
      workspaceId: "ws-test",
    },
  ]);
});
