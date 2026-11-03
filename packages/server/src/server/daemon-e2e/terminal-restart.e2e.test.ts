import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHeadlessTerminal } from "../../terminal/headless-terminal.js";
import { expect, test } from "vitest";
import { listTerminalWorkerRecords } from "../../terminal/terminal-worker-record.js";
import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

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

async function subscribeTerminalReplay(ctx: DaemonTestContext, terminalId: string) {
  const terminal = createHeadlessTerminal({ rows: 30, cols: 120, scrollback: 10000 });
  let complete!: (text: string) => void;
  let fail!: (error: Error) => void;
  const replay = new Promise<string>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  const timeout = setTimeout(() => fail(new Error("Terminal replay timed out")), 10000);
  const subscription = ctx.client.observeTerminal(
    terminalId,
    (event) => {
      if (event.type !== "replay") return;
      const frame = event.replay;
      if (frame.type === "begin") {
        terminal.reset();
        if (frame.cols && frame.rows) terminal.resize(frame.cols, frame.rows);
      } else if (frame.type === "data") {
        terminal.write(frame.data);
      } else {
        terminal.write("", () => {
          const buffer = terminal.buffer.active;
          complete(
            Array.from({ length: buffer.length }, (_, row) =>
              buffer.getLine(row)!.translateToString(true),
            ).join("\n"),
          );
        });
      }
    },
    { restore: { mode: "full-snapshot" } },
  );
  try {
    const ready = await subscription.ready;
    expect(ready.error).toBeNull();
    return { text: await replay, subscription };
  } catch (error) {
    await subscription.release();
    throw error;
  } finally {
    clearTimeout(timeout);
    terminal.dispose();
  }
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

test("terminal stays alive and captures output across daemon restart", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "daemon-terminal-restart-"));
  const cwd = path.join(root, "workspace");
  const paseoHomeRoot = path.join(root, "home");
  const staticDir = path.join(root, "static");
  const gatePath = path.join(root, "emit-while-daemon-stopped");
  const ackPath = path.join(root, "detached-output-ack");
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
    const initialSubscription = await subscribeTerminalReplay(ctx, terminalId);
    const initialText = initialSubscription.text;
    const pid = initialText.match(/READY:(\d+)/)?.[1];
    expect(pid).toEqual(expect.stringMatching(/^\d+$/));

    await initialSubscription.subscription.release();
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
    const restoredSubscription = await subscribeTerminalReplay(ctx, terminalId);
    const restoredText = restoredSubscription.text;
    expect(restoredText).toContain(`READY:${pid}`);
    expect(restoredText).toContain(`DURING:${pid}`);

    const afterOutputPromise = waitForTerminalOutput(ctx, terminalId, (text) =>
      text.includes(`AFTER:${pid}`),
    );
    ctx.client.sendTerminalInput(terminalId, { type: "input", data: "a\r" });
    expect(await afterOutputPromise).toContain(`AFTER:${pid}`);
    await restoredSubscription.subscription.release();
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
    expect(await listTerminalWorkerRecords(path.join(paseoHomeRoot, ".paseo"))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  }
}, 60_000);
