import assert from "node:assert/strict";
import { runPaseoCli } from "../../../../cli/tests/helpers/test-daemon.js";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

interface Harness {
  daemon: TestPaseoDaemon;
  client: DaemonClient;
  prompts: string[];
  createAgent: () => Promise<string>;
  fetchAgent: (agentId: string) => Promise<AgentSnapshotPayload>;
  holdTurn: (match: string) => { release: () => void; started: Promise<void> };
  close: () => Promise<void>;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })),
  );
});

function promptText(prompt: AgentPromptInput): string {
  if (typeof prompt === "string") return prompt;
  return JSON.stringify(prompt);
}

async function makeRoot(): Promise<{ root: string; cwd: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-if-idle-"));
  roots.push(root);
  const cwd = await mkdtemp(path.join(root, "cwd-"));
  return { root, cwd };
}

async function startHarness(root: string, cwd: string): Promise<Harness> {
  const prompts: string[] = [];
  const startWaiters: Array<() => void> = [];
  let holdMatch: string | null = null;
  let holdRelease: Promise<void> | null = null;

  const agentClients = createTestAgentClients({
    onStartTurn: (prompt, config) => {
      if (config.internal) return;
      prompts.push(promptText(prompt));
      for (const resolve of startWaiters.splice(0)) resolve();
    },
    beforeTurnComplete: async (prompt) => {
      if (holdMatch === null || !promptText(prompt).includes(holdMatch)) return;
      const release = holdRelease;
      holdMatch = null;
      holdRelease = null;
      await release;
    },
  });

  const daemon = await createTestPaseoDaemon({
    paseoHomeRoot: root,
    cleanup: false,
    agentClients,
    pluginsEnabled: false,
  });
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    appVersion: "0.13.0",
  });
  await client.connect();
  await client.fetchAgents({ subscribe: {} });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await client.close().catch(() => undefined);
    await daemon.close().catch(() => undefined);
  };

  return {
    daemon,
    client,
    prompts,
    createAgent: async () => {
      const agent = await client.createAgent({ config: { provider: "codex", cwd } });
      return agent.id;
    },
    fetchAgent: async (agentId) => {
      const result = await client.fetchAgent({ agentId });
      if (!result?.agent) throw new Error(`Agent ${agentId} not found`);
      return result.agent;
    },
    holdTurn: (match) => {
      let release!: () => void;
      holdRelease = new Promise<void>((resolve) => {
        release = resolve;
      });
      holdMatch = match;
      const started = new Promise<void>((resolve) => startWaiters.push(resolve));
      return { release, started };
    },
    close,
  };
}

async function timelineText(harness: Harness, agentId: string): Promise<string[]> {
  const timeline = await harness.client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 50,
  });
  return timeline.entries.flatMap((entry) => {
    const item = entry.item;
    if (item.type === "user_message" || item.type === "assistant_message") return [item.text];
    return [];
  });
}

test("idle delivery starts a turn in the original provider session", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  try {
    const agentId = await harness.createAgent();
    const before = await harness.fetchAgent(agentId);
    const sessionId = before.persistence?.sessionId;
    expect(sessionId).toBeTypeOf("string");

    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "idle notification", {
        messageId: "idle-1",
      }),
    ).resolves.toEqual({ agentId });
    const finished = await harness.client.waitForFinish(agentId, 10_000);
    expect(finished.status).toBe("idle");

    const after = await harness.fetchAgent(agentId);
    expect(after.persistence?.sessionId).toBe(sessionId);
    expect(after.status).toBe("idle");
    expect(harness.prompts.filter((prompt) => prompt.includes("idle notification"))).toHaveLength(
      1,
    );
    expect(await timelineText(harness, agentId)).toContain("idle notification");
  } finally {
    await harness.close();
  }
});

test("an active turn rejects idle delivery without side effects, then retries after it finishes", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  try {
    const agentId = await harness.createAgent();
    const before = await harness.fetchAgent(agentId);
    const hold = harness.holdTurn("active turn");

    await harness.client.sendMessage(agentId, "active turn");
    await hold.started;

    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "rejected idle notification", {
        messageId: "busy-1",
      }),
    ).rejects.toMatchObject({ code: "agent_busy" });

    const during = await harness.fetchAgent(agentId);
    expect(during.status).toBe("running");
    expect(during.persistence?.sessionId).toBe(before.persistence?.sessionId);
    expect(during.archivedAt ?? null).toBe(before.archivedAt ?? null);
    expect(during.pendingPermissions ?? []).toEqual(before.pendingPermissions ?? []);
    expect(
      harness.prompts.filter((prompt) => prompt.includes("rejected idle notification")),
    ).toHaveLength(0);
    expect(await timelineText(harness, agentId)).not.toContain("rejected idle notification");

    hold.release();
    await harness.client.waitForFinish(agentId, 10_000);

    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "rejected idle notification", {
        messageId: "busy-1",
      }),
    ).resolves.toEqual({ agentId });
    await harness.client.waitForFinish(agentId, 10_000);
    expect(
      harness.prompts.filter((prompt) => prompt.includes("rejected idle notification")),
    ).toHaveLength(1);
  } finally {
    await harness.close();
  }
});

test("simultaneous idle deliveries admit exactly one turn", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  const hold = harness.holdTurn("race notification");
  try {
    const agentId = await harness.createAgent();
    const results = await Promise.allSettled([
      harness.client.sendAgentMessageIfIdle(agentId, "race notification one", {
        messageId: "race-1",
      }),
      harness.client.sendAgentMessageIfIdle(agentId, "race notification two", {
        messageId: "race-2",
      }),
    ]);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "agent_busy" });
    expect(harness.prompts.filter((prompt) => prompt.includes("race notification"))).toHaveLength(
      1,
    );

    hold.release();
    await harness.client.waitForFinish(agentId, 10_000);
  } finally {
    hold.release();
    await harness.close();
  }
});

test("a completed duplicate after a daemon restart is acknowledged without another turn", async () => {
  const { root, cwd } = await makeRoot();
  const first = await startHarness(root, cwd);
  let agentId: string;
  try {
    agentId = await first.createAgent();
    await first.client.sendAgentMessageIfIdle(agentId, "replay notification", {
      messageId: "replay-1",
    });
    await first.client.waitForFinish(agentId, 10_000);
  } finally {
    await first.close();
  }

  const second = await startHarness(root, cwd);
  try {
    const before = await second.fetchAgent(agentId);
    await expect(
      second.client.sendAgentMessageIfIdle(agentId, "replay notification", {
        messageId: "replay-1",
      }),
    ).resolves.toEqual({ agentId });
    expect(second.prompts).toHaveLength(0);
    const after = await second.fetchAgent(agentId);
    expect(after.persistence?.sessionId).toBe(before.persistence?.sessionId);
  } finally {
    await second.close();
  }
});

test("a receipt left pending by a crash stays outcome_unknown instead of replaying", async () => {
  const { root, cwd } = await makeRoot();
  const first = await startHarness(root, cwd);
  let agentId: string;
  try {
    agentId = await first.createAgent();
    await first.client.sendAgentMessageIfIdle(agentId, "ambiguous notification", {
      messageId: "ambiguous-1",
    });
    await first.client.waitForFinish(agentId, 10_000);
  } finally {
    await first.close();
  }

  const receiptDirectory = path.join(root, ".paseo", "agent-requests");
  const [receiptFile] = await readdir(receiptDirectory);
  const receiptPath = path.join(receiptDirectory, receiptFile);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as { state: string };
  expect(receipt.state).toBe("completed");
  await writeFile(receiptPath, JSON.stringify({ ...receipt, state: "pending" }), "utf8");

  const second = await startHarness(root, cwd);
  try {
    await expect(
      second.client.sendAgentMessageIfIdle(agentId, "ambiguous notification", {
        messageId: "ambiguous-1",
      }),
    ).rejects.toMatchObject({ code: "agent_request_outcome_unknown" });
    expect(second.prompts).toHaveLength(0);
  } finally {
    await second.close();
  }
});

test("the same message ID with a different request is a conflict", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  try {
    const agentId = await harness.createAgent();
    await harness.client.sendAgentMessageIfIdle(agentId, "first notification", {
      messageId: "conflict-1",
    });
    await harness.client.waitForFinish(agentId, 10_000);

    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "different notification", {
        messageId: "conflict-1",
      }),
    ).rejects.toMatchObject({ code: "agent_request_key_conflict" });
    expect(
      harness.prompts.filter((prompt) => prompt.includes("different notification")),
    ).toHaveLength(0);
  } finally {
    await harness.close();
  }
});

test("an archived agent rejects idle delivery without unarchiving it", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  try {
    const agentId = await harness.createAgent();
    await harness.client.archiveAgent(agentId);
    const archived = await harness.fetchAgent(agentId);
    expect(archived.archivedAt).toBeTypeOf("string");

    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "archived notification", {
        messageId: "archived-1",
      }),
    ).rejects.toThrow(/archived/);
    expect(harness.prompts).toHaveLength(0);
    const after = await harness.fetchAgent(agentId);
    expect(after.archivedAt).toBe(archived.archivedAt);
  } finally {
    await harness.close();
  }
});

test("a completed duplicate is acknowledged while an unrelated turn is busy", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  const hold = harness.holdTurn("unrelated busy turn");
  try {
    const agentId = await harness.createAgent();
    await harness.client.sendAgentMessageIfIdle(agentId, "replayed notification", {
      messageId: "replay-busy-1",
    });
    await harness.client.waitForFinish(agentId, 10_000);
    const settled = await harness.fetchAgent(agentId);

    await harness.client.sendMessage(agentId, "unrelated busy turn");
    await hold.started;
    const busyBefore = await harness.fetchAgent(agentId);
    expect(busyBefore.status).toBe("running");
    expect(busyBefore.activeTurn?.turnId).toBeTypeOf("string");

    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "replayed notification", {
        messageId: "replay-busy-1",
      }),
    ).resolves.toEqual({ agentId });

    const busyAfter = await harness.fetchAgent(agentId);
    expect(busyAfter.status).toBe("running");
    expect(busyAfter.activeTurn?.turnId).toBe(busyBefore.activeTurn?.turnId);
    expect(busyAfter.persistence?.sessionId).toBe(settled.persistence?.sessionId);
    expect(
      harness.prompts.filter((prompt) => prompt.includes("replayed notification")),
    ).toHaveLength(1);
    expect(harness.prompts.filter((prompt) => prompt.includes("unrelated busy turn"))).toHaveLength(
      1,
    );
    expect(
      (await timelineText(harness, agentId)).filter((text) =>
        text.includes("replayed notification"),
      ),
    ).toHaveLength(1);
    expect(
      (await timelineText(harness, agentId)).filter((text) => text.includes("unrelated busy turn")),
    ).toHaveLength(1);

    hold.release();
    await harness.client.waitForFinish(agentId, 10_000);
    expect(
      harness.prompts.filter((prompt) => prompt.includes("replayed notification")),
    ).toHaveLength(1);
  } finally {
    hold.release();
    await harness.close();
  }
});

test("archive during idle preflight cannot leave a history runtime ready to execute", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  const manager = harness.daemon.daemon.agentManager;
  const waitForClose = manager.waitForAgentClose.bind(manager);
  const hook = vi.spyOn(manager, "waitForAgentClose");
  try {
    const agentId = await harness.createAgent();
    hook.mockImplementationOnce(async (id) => {
      await manager.archiveAgent(id);
      await waitForClose(id);
    });
    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "preflight archive", {
        messageId: "preflight-archive",
      }),
    ).rejects.toThrow(/archived/);
    expect(harness.prompts).toHaveLength(0);
    expect(manager.getAgent(agentId) === null).toBe(true);
    expect((await harness.fetchAgent(agentId)).archivedAt).toBeTruthy();
  } finally {
    hook.mockRestore();
    await harness.close();
  }
});

test("archive at final admission leaves no receipt preventing an explicit retry after unarchive", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  const manager = harness.daemon.daemon.agentManager;
  const admit = manager.tryStreamAgentIfIdle.bind(manager);
  const hook = vi.spyOn(manager, "tryStreamAgentIfIdle");
  try {
    const agentId = await harness.createAgent();
    hook.mockImplementationOnce(async (...args) => {
      await manager.archiveAgent(args[0]);
      return admit(...args);
    });
    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "admission archive", {
        messageId: "admission-archive",
      }),
    ).rejects.toThrow(/archived/);
    expect(harness.prompts).toHaveLength(0);
    await manager.unarchiveSnapshot(agentId);
    await expect(
      harness.client.sendAgentMessageIfIdle(agentId, "admission archive", {
        messageId: "admission-archive",
      }),
    ).resolves.toEqual({ agentId });
    await harness.client.waitForFinish(agentId, 10_000);
    expect(harness.prompts.filter((prompt) => prompt.includes("admission archive"))).toHaveLength(
      1,
    );
  } finally {
    hook.mockRestore();
    await harness.close();
  }
});

test("CLI idle-only delivery preserves structured busy, retry, and replay results", async () => {
  const { root, cwd } = await makeRoot();
  const harness = await startHarness(root, cwd);
  try {
    const idlePromptFile = path.join(root, "cli-idle.txt");
    const busyPromptFile = path.join(root, "cli-busy.txt");
    const idleText = "cli idle-only notification";
    const busyText = "cli busy notification";
    await writeFile(idlePromptFile, idleText);
    await writeFile(busyPromptFile, busyText);
    const cliContext = { paseoHome: harness.daemon.paseoHome, workDir: cwd };
    const sendArgs = (target: string, messageId: string, promptFile: string) => [
      "--json",
      "send",
      target,
      "--if-idle",
      "--message-id",
      messageId,
      "--prompt-file",
      promptFile,
      "--no-wait",
      "--host",
      `127.0.0.1:${harness.daemon.port}`,
    ];
    const runCli = (args: string[]) =>
      runPaseoCli(cliContext, args, {
        // Keep tsx loader deprecation notices out of the CLI's JSON streams.
        env: { PASEO_AGENT_ID: "", NODE_OPTIONS: "--no-deprecation --conditions=source" },
        timeout: 30000,
      });

    const created = await harness.client.createAgent({
      config: { provider: "codex", cwd },
    });
    const agentId = created.id;
    const prefix = agentId.slice(0, 8);
    const before = await harness.fetchAgent(agentId);
    const sessionId = before.persistence?.sessionId;
    assert.strictEqual(typeof sessionId, "string", "fake provider should expose a session ID");

    // Idle delivery starts a turn and returns the canonical ID.
    const idle = await runCli(sendArgs(prefix, "cli-idle-1", idlePromptFile));
    assert.strictEqual(idle.exitCode, 0, `idle send should succeed: ${idle.stderr}`);
    const idleResult = JSON.parse(idle.stdout.trim());
    assert.deepStrictEqual(
      { agentId: idleResult.agentId, status: idleResult.status },
      { agentId, status: "sent" },
      "idle send should return the canonical agent ID and sent status",
    );
    await harness.client.waitForFinish(agentId, 10_000);
    assert.strictEqual(
      harness.prompts.filter((prompt) => prompt.includes(idleText)).length,
      1,
      "idle send should dispatch exactly one prompt",
    );

    // A held turn rejects with agent_busy and no side effects.
    const hold = harness.holdTurn("cli active turn");
    try {
      await harness.client.sendMessage(agentId, "cli active turn");
      await hold.started;

      const busy = await runCli(sendArgs(prefix, "cli-idle-busy", busyPromptFile));
      assert.notStrictEqual(busy.exitCode, 0, "busy idle-only send should fail");
      const busyError = JSON.parse(busy.stderr.trim());
      assert.strictEqual(busyError.error.code, "agent_busy", "stderr should report agent_busy");
      assert.strictEqual(
        harness.prompts.filter((prompt) => prompt.includes(busyText)).length,
        0,
        "busy rejection should not dispatch the rejected prompt",
      );
      const during = await harness.fetchAgent(agentId);
      assert.strictEqual(during.status, "running", "the active turn should keep running");
      assert.strictEqual(during.persistence?.sessionId, sessionId);
    } finally {
      hold.release();
    }
    await harness.client.waitForFinish(agentId, 10_000);

    // Retrying the same message ID after the turn finishes succeeds once.
    const retry = await runCli(sendArgs(prefix, "cli-idle-busy", busyPromptFile));
    assert.strictEqual(retry.exitCode, 0, `retry should succeed: ${retry.stderr}`);
    const retryResult = JSON.parse(retry.stdout.trim());
    assert.strictEqual(retryResult.agentId, agentId);
    assert.strictEqual(retryResult.status, "sent");
    await harness.client.waitForFinish(agentId, 10_000);
    assert.strictEqual(
      harness.prompts.filter((prompt) => prompt.includes(busyText)).length,
      1,
      "retry should dispatch the prompt exactly once",
    );

    // A completed replay is acknowledged without another turn.
    const replay = await runCli(sendArgs(prefix, "cli-idle-busy", busyPromptFile));
    assert.strictEqual(replay.exitCode, 0, `replay should be acknowledged: ${replay.stderr}`);
    const replayResult = JSON.parse(replay.stdout.trim());
    assert.strictEqual(replayResult.agentId, agentId);
    assert.strictEqual(replayResult.status, "sent");
    assert.strictEqual(
      harness.prompts.filter((prompt) => prompt.includes(busyText)).length,
      1,
      "completed replay should not execute again",
    );

    const after = await harness.fetchAgent(agentId);
    assert.strictEqual(
      after.persistence?.sessionId,
      sessionId,
      "native session ID must not change",
    );
    assert.strictEqual(after.status, "idle");
  } finally {
    await harness.close();
  }
}, 60_000);
