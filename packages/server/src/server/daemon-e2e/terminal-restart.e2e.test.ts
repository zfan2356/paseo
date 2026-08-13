import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TerminalState } from "@getpaseo/protocol/messages";
import { expect, test } from "vitest";
import { resolvePersistentTerminalWorkerRuntime } from "../../terminal/persistent-terminal-worker-transport.js";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

function extractStateText(state: Pick<TerminalState, "grid" | "scrollback">): string {
  return [...state.scrollback, ...state.grid]
    .map((row) =>
      row
        .map((cell) => cell.char)
        .join("")
        .trimEnd(),
    )
    .filter((line) => line.length > 0)
    .join("\n");
}

async function waitForCondition(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 25,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

function waitForTerminalSnapshot(
  ctx: DaemonTestContext,
  terminalId: string,
  timeoutMs = 10_000,
): Promise<TerminalState> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for terminal snapshot after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsubscribe = ctx.client.onTerminalStreamEvent((event) => {
      if (event.terminalId !== terminalId || event.type !== "snapshot") {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(event.state);
    });
  });
}

function waitForTerminalOutput(
  ctx: DaemonTestContext,
  terminalId: string,
  predicate: (text: string) => boolean,
  timeoutMs = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const decoder = new TextDecoder();
    let text = "";
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for terminal output after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsubscribe = ctx.client.onTerminalStreamEvent((event) => {
      if (event.terminalId !== terminalId || event.type !== "output") {
        return;
      }
      text += decoder.decode(event.data, { stream: true });
      if (!predicate(text)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(text);
    });
  });
}

async function waitForCapturedText(
  ctx: DaemonTestContext,
  terminalId: string,
  predicate: (text: string) => boolean,
): Promise<string> {
  let text = "";
  await waitForCondition(async () => {
    const capture = await ctx.client.captureTerminal(terminalId);
    text = capture.lines.join("\n");
    return predicate(text);
  }, 10_000);
  return text;
}

async function canConnectToEndpoint(endpoint: string): Promise<boolean> {
  const socket = net.createConnection(endpoint);
  const connected = await Promise.race([
    new Promise<boolean>((resolve) => socket.once("connect", () => resolve(true))),
    new Promise<boolean>((resolve) => socket.once("error", () => resolve(false))),
    new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(true), 250);
      timeout.unref();
    }),
  ]);
  socket.destroy();
  return connected;
}

test("terminal stays alive and captures output across daemon restart", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "daemon-terminal-restart-"));
  const cwd = path.join(root, "workspace");
  const paseoHomeRoot = path.join(root, "home");
  const staticDir = path.join(root, "static");
  const gatePath = path.join(root, "emit-while-daemon-stopped");
  const ackPath = path.join(root, "detached-output-ack");
  const workerEndpoint = resolvePersistentTerminalWorkerRuntime(
    path.join(paseoHomeRoot, ".paseo"),
  ).endpoint;
  let ctx: DaemonTestContext | null = null;
  let terminalId: string | null = null;

  try {
    mkdirSync(cwd, { recursive: true });
    mkdirSync(staticDir, { recursive: true });
    ctx = await createDaemonTestContext({
      paseoHomeRoot,
      staticDir,
      cleanup: false,
      preserveTerminalsOnClose: true,
    });
    const opened = await ctx.client.openProject(cwd);
    if (!opened.workspace) {
      throw new Error(opened.error ?? "Failed to open terminal restart workspace");
    }
    const script = `
      const fs = require("node:fs");
      const pid = process.pid;
      process.stdout.write("READY:" + pid + "\\n");
      const gate = setInterval(() => {
        if (!fs.existsSync(${JSON.stringify(gatePath)})) return;
        clearInterval(gate);
        process.stdout.write("DURING:" + pid + "\\n");
        fs.writeFileSync(${JSON.stringify(ackPath)}, String(pid));
      }, 10);
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (data) => {
        if (data.includes("a")) process.stdout.write("AFTER:" + pid + "\\n");
      });
      setInterval(() => {}, 1000);
    `;
    const created = await ctx.client.createTerminal(cwd, "Restart terminal", undefined, {
      workspaceId: opened.workspace.id,
      command: process.execPath,
      args: ["-e", script],
    });
    terminalId = created.terminal?.id ?? null;
    if (!terminalId) {
      throw new Error(created.error ?? "Failed to create restart terminal");
    }

    await waitForCapturedText(ctx, terminalId, (text) => text.includes("READY:"));
    const initialSnapshotPromise = waitForTerminalSnapshot(ctx, terminalId);
    const initialSubscription = await ctx.client.subscribeTerminal(terminalId);
    expect(initialSubscription.error).toBeNull();
    const initialText = extractStateText(await initialSnapshotPromise);
    const pid = initialText.match(/READY:(\d+)/)?.[1];
    expect(pid).toEqual(expect.stringMatching(/^\d+$/));

    await ctx.cleanup();
    ctx = null;
    writeFileSync(gatePath, "go");
    await waitForCondition(() => existsSync(ackPath), 10_000);
    expect(readFileSync(ackPath, "utf8")).toBe(pid);

    ctx = await createDaemonTestContext({ paseoHomeRoot, staticDir, cleanup: false });
    const listed = await ctx.client.listTerminals(cwd);
    expect(listed.terminals.map((terminal) => terminal.id)).toEqual([terminalId]);

    await waitForCapturedText(
      ctx,
      terminalId,
      (text) => text.includes(`READY:${pid}`) && text.includes(`DURING:${pid}`),
    );
    const restoredSnapshotPromise = waitForTerminalSnapshot(ctx, terminalId);
    const restoredSubscription = await ctx.client.subscribeTerminal(terminalId);
    expect(restoredSubscription.error).toBeNull();
    const restoredText = extractStateText(await restoredSnapshotPromise);
    expect(restoredText).toContain(`READY:${pid}`);
    expect(restoredText).toContain(`DURING:${pid}`);

    const afterOutputPromise = waitForTerminalOutput(ctx, terminalId, (text) =>
      text.includes(`AFTER:${pid}`),
    );
    ctx.client.sendTerminalInput(terminalId, { type: "input", data: "a\r" });
    expect(await afterOutputPromise).toContain(`AFTER:${pid}`);
  } finally {
    if (!ctx && terminalId) {
      ctx = await createDaemonTestContext({ paseoHomeRoot, staticDir, cleanup: false });
    }
    if (ctx && terminalId) {
      await ctx.daemon.daemon.terminalManager.killTerminalAndWait(terminalId, {
        gracefulTimeoutMs: 1_000,
        forceTimeoutMs: 500,
      });
      expect((await ctx.client.listTerminals(cwd)).terminals).toEqual([]);
    }
    await ctx?.cleanup();
    await waitForCondition(async () => !(await canConnectToEndpoint(workerEndpoint)), 5_000);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
