import { expect, test, vi } from "vitest";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";

function createQueryFactory(turns: SDKMessage[][]) {
  return vi.fn(({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    const messages: SDKMessage[] = [];
    const waiters: Array<() => void> = [];
    let turnIndex = 0;
    const closed = { value: false };

    function wake(): void {
      waiters.shift()?.();
    }

    void (async () => {
      for await (const _ of prompt) {
        messages.push(...(turns[turnIndex] ?? []));
        turnIndex += 1;
        wake();
      }
      closed.value = true;
      wake();
    })();

    return {
      async next() {
        while (messages.length === 0 && !closed.value) {
          await new Promise<void>((resolve) => waiters.push(resolve));
        }
        const value = messages.shift();
        return value ? { done: false as const, value } : { done: true as const, value: undefined };
      },
      async return() {
        closed.value = true;
        wake();
        return { done: true as const, value: undefined };
      },
      close() {
        closed.value = true;
        wake();
      },
      applyFlagSettings: vi.fn(async () => undefined),
      setPermissionMode: vi.fn(async () => undefined),
      setModel: vi.fn(async () => undefined),
      getContextUsage: vi.fn(async () => undefined),
      supportedModels: vi.fn(async () => []),
      supportedCommands: vi.fn(async () => []),
      rewindFiles: vi.fn(async () => ({ canRewind: true })),
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  });
}

test("side chat forks Claude through the last completed turn", async () => {
  const forkSession = vi.fn(async () => ({ sessionId: "side-session" }));
  const deleteSession = vi.fn(async () => undefined);
  const queryFactory = createQueryFactory([
    [
      {
        type: "system",
        subtype: "init",
        session_id: "main-session",
        permissionMode: "default",
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "assistant-message",
          role: "assistant",
          content: [{ type: "text", text: "Finished answer" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        session_id: "main-session",
        uuid: "completed-assistant-message",
      } as SDKMessage,
      {
        type: "result",
        subtype: "success",
        duration_ms: 1,
        duration_api_ms: 1,
        is_error: false,
        num_turns: 1,
        result: "Finished answer",
        stop_reason: null,
        total_cost_usd: 0,
        usage: { input_tokens: 1, output_tokens: 1 },
        modelUsage: {},
        permission_denials: [],
        uuid: "completed-result",
        session_id: "main-session",
      } as SDKMessage,
    ],
    [
      {
        type: "assistant",
        message: {
          id: "active-assistant-message",
          role: "assistant",
          content: [{ type: "text", text: "Still working" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        session_id: "main-session",
        uuid: "active-assistant-message",
      } as SDKMessage,
    ],
  ]);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: async () => "/test/claude/bin",
    sideChatSdk: { forkSession, deleteSession },
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: "/workspace/project",
  });

  await session.run("finish this turn");
  await session.startTurn("start a long-running task");
  const handle = await session.forkForSideChat?.();

  expect(forkSession).toHaveBeenCalledWith("main-session", {
    dir: "/workspace/project",
    upToMessageId: "completed-result",
  });
  expect(handle?.sessionId).toBe("side-session");

  if (handle) {
    await session.disposeSideChatFork?.(handle);
  }
  expect(deleteSession).toHaveBeenCalledWith("side-session", { dir: "/workspace/project" });
  await session.close();
});

test("side chat never copies Claude's first in-progress turn", async () => {
  const forkSession = vi.fn(async () => ({ sessionId: "side-session" }));
  const queryFactory = createQueryFactory([
    [
      {
        type: "system",
        subtype: "init",
        session_id: "main-session",
        permissionMode: "default",
      } as SDKMessage,
      {
        type: "assistant",
        message: {
          id: "active-assistant-message",
          role: "assistant",
          content: [{ type: "text", text: "Still working" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        session_id: "main-session",
        uuid: "active-assistant-message",
      } as SDKMessage,
    ],
  ]);
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    queryFactory,
    resolveBinary: async () => "/test/claude/bin",
    sideChatSdk: {
      forkSession,
      deleteSession: vi.fn(async () => undefined),
    },
  });
  const session = await client.createSession({
    provider: "claude",
    cwd: "/workspace/project",
  });
  const threadStarted = new Promise<void>((resolve) => {
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "thread_started") {
        unsubscribe();
        resolve();
      }
    });
  });

  await session.startTurn("start the first long-running task");
  await threadStarted;

  await expect(session.forkForSideChat?.()).rejects.toThrow(
    "Claude side chat requires a completed turn before the active turn",
  );
  expect(forkSession).not.toHaveBeenCalled();
  await session.close();
});
