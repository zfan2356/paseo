import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { terminateWithTreeKill } from "../../../../utils/tree-kill.js";
import type { AgentSession, AgentStreamEvent } from "../../agent-sdk-types.js";
import { CodexAppServerAgentClient } from "../codex-app-server-agent.js";
import { CodexAppServerClient } from "./app-server-transport.js";
import { CodexAppServerSocket } from "./shared-app-server.js";
import { AgentManager } from "../../agent-manager.js";
import { AgentStorage } from "../../agent-storage.js";

const ThreadResponse = z.object({
  thread: z.object({
    id: z.string(),
    status: z.object({ type: z.string() }),
    turns: z.array(z.object({ id: z.string(), status: z.string() })).default([]),
  }),
});

function eventQueue<T>() {
  const received: T[] = [];
  const waiters = new Set<() => void>();
  return {
    received,
    push(event: T) {
      received.push(event);
      for (const wake of waiters) wake();
    },
    async wait(predicate: (event: T) => boolean): Promise<T> {
      const found = received.find(predicate);
      if (found) return found;
      return new Promise((resolve, reject) => {
        const check = () => {
          const match = received.find(predicate);
          if (!match) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(match);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("Timed out waiting for shared Codex event"));
        }, 15_000);
        waiters.add(check);
      });
    },
    clear() {
      received.length = 0;
    },
  };
}

interface Notification {
  method: string;
  params: unknown;
}

async function startFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-shared-codex-"));
  const home = path.join(root, "home");
  await mkdir(home);
  const responses = new Set<ServerResponse>();
  const completions = new Set<() => void>();
  let requestCount = 0;
  // Only inference is deterministic; Codex, its socket, persistence, and clients are real.
  const api = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    if (request.method !== "POST" || request.url !== "/v1/responses") {
      response.writeHead(404).end();
      return;
    }
    requestCount++;
    responses.add(response);
    response.on("close", () => responses.delete(response));
    response.writeHead(200, { "content-type": "text/event-stream" });
    const emit = (type: string, fields: Record<string, unknown>) => {
      response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    };
    const id = `message-${requestCount}`;
    emit("response.created", {
      response: { id: `response-${requestCount}`, status: "in_progress", output: [] },
    });
    emit("response.output_item.added", {
      output_index: 0,
      item: { id, type: "message", role: "assistant", status: "in_progress", content: [] },
    });
    emit("response.content_part.added", {
      item_id: id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    emit("response.output_text.delta", {
      item_id: id,
      output_index: 0,
      content_index: 0,
      delta: "SHARED_STREAM_READY",
    });
    const complete = () => {
      const item = {
        id,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "SHARED_STREAM_READY", annotations: [] }],
      };
      emit("response.output_item.done", { output_index: 0, item });
      emit("response.completed", {
        response: {
          id: `response-${id}`,
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
      response.end();
    };
    completions.add(complete);
    response.on("close", () => completions.delete(complete));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  if (!address || typeof address === "string") throw new Error("Expected fixture TCP address");
  await writeFile(
    path.join(home, "config.toml"),
    `
model = "gpt-5.4"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
check_for_update_on_startup = false
[model_providers.fixture]
name = "Loopback fixture"
base_url = "http://127.0.0.1:${address.port}/v1"
wire_api = "responses"
requires_openai_auth = false
`,
  );
  const socketPath = path.join(root, "codex.sock");
  const process: ChildProcessWithoutNullStreams = spawn(
    "codex",
    ["app-server", "--listen", `unix://${socketPath}`],
    {
      cwd: root,
      env: { ...globalThis.process.env, CODEX_HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  process.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-8000);
  });
  const sessions: AgentSession[] = [];
  const clients: CodexAppServerClient[] = [];
  const close = async () => {
    for (const session of sessions) await session.close();
    for (const client of clients) await client.dispose();
    await terminateWithTreeKill(process, { gracefulTimeoutMs: 2000, forceTimeoutMs: 1000 });
    for (const response of responses) response.destroy();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  };
  try {
    await expect
      .poll(
        async () => {
          if (process.exitCode !== null) throw new Error(stderr);
          try {
            return (await stat(socketPath)).isSocket();
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(true);
    const native = new CodexAppServerClient(
      await CodexAppServerSocket.connect(socketPath),
      createTestLogger(),
    );
    clients.push(native);
    await native.request("initialize", {
      clientInfo: { name: "shared_codex_e2e", version: "1" },
      capabilities: { experimentalApi: true },
    });
    native.notify("initialized", {});
    const events = eventQueue<Notification>();
    native.setNotificationHandler((method, params) => events.push({ method, params }));
    const provider = new CodexAppServerAgentClient(createTestLogger(), {
      env: { PASEO_CODEX_APP_SERVER_SOCKET: socketPath },
    });
    return {
      root,
      native,
      events,
      provider,
      sessions,
      close,
      requestCount: () => requestCount,
      complete: () => {
        for (const finish of completions) finish();
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

function isMarker(event: AgentStreamEvent): boolean {
  return (
    event.type === "timeline" &&
    event.item.type === "assistant_message" &&
    event.item.text.includes("SHARED_STREAM_READY")
  );
}

describe("shared Codex service", () => {
  test("fails a missing socket without falling back to an independent writer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "paseo-missing-codex-"));
    try {
      const provider = new CodexAppServerAgentClient(createTestLogger(), {
        env: { PASEO_CODEX_APP_SERVER_SOCKET: path.join(root, "missing.sock") },
      });
      await expect(provider.createSession({ provider: "codex", cwd: root })).rejects.toThrow(
        "ENOENT",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("publishes native-client activity through Paseo's managed running state", async () => {
    const fixture = await startFixture();
    const logger = createTestLogger();
    const storage = new AgentStorage(path.join(fixture.root, "agents"), logger);
    const manager = new AgentManager({
      clients: { codex: fixture.provider },
      registry: storage,
      logger,
    });
    let agentId: string | null = null;
    try {
      const agent = await manager.createAgent(
        { provider: "codex", cwd: fixture.root, model: "gpt-5.4", modeId: "full-access" },
        undefined,
        { workspaceId: undefined },
      );
      agentId = agent.id;
      const run = manager.runAgent(agent.id, "Start from Paseo.");
      await expect.poll(fixture.requestCount).toBe(1);
      const threadId = manager.getAgent(agent.id)?.persistence?.sessionId;
      const resumed = ThreadResponse.parse(
        await fixture.native.request("thread/resume", { threadId }),
      );
      const turnId = resumed.thread.turns.find((turn) => turn.status === "inProgress")?.id;
      await fixture.native.request("turn/interrupt", { threadId, turnId });
      expect((await run).canceled).toBe(true);
      await expect.poll(() => manager.getAgent(agent.id)?.lifecycle).toBe("idle");

      await fixture.native.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "Start from the other client." }],
      });
      await expect.poll(() => manager.getAgent(agent.id)?.lifecycle).toBe("running");
      expect(await manager.cancelAgentRun(agent.id)).toEqual({ status: "settled" });
      await expect.poll(() => manager.getAgent(agent.id)?.lifecycle).toBe("idle");
    } finally {
      if (agentId) await manager.closeAgent(agentId);
      await storage.flush();
      await fixture.close();
    }
  }, 45_000);

  test("opens a native paginated conversation without creating another writer", async () => {
    const fixture = await startFixture();
    try {
      const created = ThreadResponse.parse(
        await fixture.native.request("thread/start", {
          cwd: fixture.root,
          historyMode: "paginated",
          model: "gpt-5.4",
        }),
      );
      const threadId = created.thread.id;
      await fixture.native.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "A native paginated conversation." }],
      });
      await fixture.events.wait((event) => event.method === "item/agentMessage/delta");
      const session = await fixture.provider.resumeSession(
        { sessionId: threadId },
        { cwd: fixture.root, model: "gpt-5.4" },
      );
      fixture.sessions.push(session);
      const history: AgentStreamEvent[] = [];
      for await (const event of session.streamHistory()) history.push(event);
      expect(
        history.some(
          (event) =>
            event.type === "timeline" &&
            event.item.type === "user_message" &&
            event.item.text === "A native paginated conversation.",
        ),
      ).toBe(true);
      await session.interrupt();
      await fixture.events.wait((event) => event.method === "turn/completed");
      expect(fixture.requestCount()).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 45_000);

  test("streams one conversation in both directions and interrupts the same turn", async () => {
    const fixture = await startFixture();
    try {
      const session = await fixture.provider.createSession({
        provider: "codex",
        cwd: fixture.root,
        model: "gpt-5.4",
        modeId: "full-access",
      });
      fixture.sessions.push(session);
      const events = eventQueue<AgentStreamEvent>();
      session.subscribe((event) => events.push(event));
      await session.startTurn("Keep streaming until interrupted.");
      await events.wait(isMarker);
      const threadId = (await session.getRuntimeInfo()).sessionId;
      const resumed = ThreadResponse.parse(
        await fixture.native.request("thread/resume", { threadId }),
      );
      expect(resumed.thread.status.type).toBe("active");
      const turnId = resumed.thread.turns.find((turn) => turn.status === "inProgress")?.id;
      expect(typeof turnId).toBe("string");
      await fixture.native.request("turn/interrupt", { threadId, turnId });
      await events.wait((event) => event.type === "turn_canceled");
      await fixture.events.wait((event) => event.method === "turn/completed");

      events.clear();
      fixture.events.clear();
      await fixture.native.request("turn/start", {
        threadId,
        input: [{ type: "text", text: "Start from the native client." }],
      });
      await events.wait((event) => event.type === "turn_started");
      await events.wait(isMarker);
      await expect(session.startTurn("Do not start a second concurrent turn.")).rejects.toThrow(
        "already active",
      );
      await session.interrupt();
      await events.wait((event) => event.type === "turn_canceled");
      await fixture.events.wait((event) => event.method === "turn/completed");
      expect(fixture.requestCount()).toBe(2);

      events.clear();
      fixture.events.clear();
      await session.startTurn("Finish normally.");
      await events.wait(isMarker);
      fixture.complete();
      await events.wait((event) => event.type === "turn_completed");
      await fixture.events.wait((event) => event.method === "turn/completed");
      expect(fixture.requestCount()).toBe(3);

      await session.close();
      const afterClose = ThreadResponse.parse(
        await fixture.native.request("thread/read", { threadId }),
      );
      expect(afterClose.thread.id).toBe(threadId);
      expect(afterClose.thread.status.type).toBe("idle");
    } finally {
      await fixture.close();
    }
  }, 45_000);

  test("isolates unrelated threads and rejoins an already loaded active conversation", async () => {
    const fixture = await startFixture();
    try {
      const session = await fixture.provider.createSession({
        provider: "codex",
        cwd: fixture.root,
        model: "gpt-5.4",
      });
      fixture.sessions.push(session);
      const events = eventQueue<AgentStreamEvent>();
      session.subscribe((event) => events.push(event));
      const unrelated = ThreadResponse.parse(
        await fixture.native.request("thread/start", { cwd: fixture.root }),
      );
      await session.listCommands();
      expect(events.received).toEqual([]);
      await session.startTurn("Create the shared transcript.");
      await events.wait(isMarker);
      const handle = session.describePersistence();
      if (!handle) throw new Error("Expected a native persistence handle");
      expect(handle.sessionId).not.toBe(unrelated.thread.id);
      await fixture.native.request("thread/resume", { threadId: handle.sessionId });
      await session.close();
      const resumed = await fixture.provider.resumeSession(handle, {
        cwd: fixture.root,
        model: "gpt-5.4",
      });
      fixture.sessions.push(resumed);
      const history: AgentStreamEvent[] = [];
      for await (const event of resumed.streamHistory()) history.push(event);
      expect(history.some((event) => event.type === "turn_started")).toBe(true);
      expect((await resumed.getRuntimeInfo()).sessionId).toBe(handle.sessionId);
      await expect(resumed.startTurn("Must not replace the active turn.")).rejects.toThrow(
        "already active",
      );
      await resumed.interrupt();
      await fixture.events.wait((event) => event.method === "turn/completed");
      expect(fixture.requestCount()).toBe(1);
    } finally {
      await fixture.close();
    }
  }, 45_000);
});
