import { describe, expect, it } from "vitest";

import {
  buildCodexSideQuestionForkParams,
  buildCodexSideQuestionPrompt,
  buildCodexSideQuestionTurnParams,
  CodexSideQuestionRun,
} from "./side-question.js";

describe("buildCodexSideQuestionPrompt", () => {
  it("prefixes the no-tools instruction", () => {
    const prompt = buildCodexSideQuestionPrompt("Why did the build fail?");
    expect(prompt).toMatch(/Do not run commands or use tools/);
    expect(prompt.endsWith("Why did the build fail?")).toBe(true);
  });
});

describe("buildCodexSideQuestionForkParams", () => {
  it("forks the full history as an ephemeral thread", () => {
    expect(
      buildCodexSideQuestionForkParams({
        threadId: "thread-1",
        cwd: "/repo",
        model: "gpt-5.4",
        serviceTier: null,
      }),
    ).toEqual({
      threadId: "thread-1",
      cwd: "/repo",
      model: "gpt-5.4",
      serviceTier: null,
      excludeTurns: false,
      ephemeral: true,
    });
  });
});

describe("buildCodexSideQuestionTurnParams", () => {
  it("locks the turn to read-only with approvals disabled", () => {
    const params = buildCodexSideQuestionTurnParams({
      threadId: "side-1",
      input: [{ type: "text", text: "q" }],
      model: "gpt-5.4",
      serviceTier: "fast",
    });
    expect(params.approvalPolicy).toBe("never");
    expect(params.sandboxPolicy).toEqual({ type: "readOnly" });
    expect(params.threadId).toBe("side-1");
    expect(params.model).toBe("gpt-5.4");
    expect(params.serviceTier).toBe("fast");
  });

  it("omits unset model and service tier", () => {
    const params = buildCodexSideQuestionTurnParams({
      threadId: "side-1",
      input: [],
      model: null,
      serviceTier: null,
    });
    expect("model" in params).toBe(false);
    expect("serviceTier" in params).toBe(false);
  });
});

describe("CodexSideQuestionRun", () => {
  it("prefers completed item text over accumulated deltas", async () => {
    const run = new CodexSideQuestionRun();
    run.handleNotification({ kind: "agent_message_delta", itemId: "m1", delta: "partial " });
    run.handleNotification({ kind: "agent_message_delta", itemId: "m1", delta: "answer" });
    run.handleNotification({
      kind: "item_completed",
      item: { id: "m1", type: "agentMessage", text: "The full answer." },
    });
    run.handleNotification({ kind: "turn_completed", status: "completed", errorMessage: null });
    await expect(run.waitForCompletion(1_000)).resolves.toEqual({
      status: "completed",
      errorMessage: null,
    });
    expect(run.answerText()).toBe("The full answer.");
  });

  it("falls back to deltas when no completed item arrived", () => {
    const run = new CodexSideQuestionRun();
    run.handleNotification({ kind: "agent_message_delta", itemId: "m1", delta: "streamed " });
    run.handleNotification({ kind: "agent_message_delta", itemId: "m1", delta: "text" });
    expect(run.answerText()).toBe("streamed text");
  });

  it("joins multiple messages and strips the compact boundary prefix", () => {
    const run = new CodexSideQuestionRun();
    run.handleNotification({
      kind: "item_completed",
      item: { id: "m1", type: "agentMessage", text: "First." },
    });
    run.handleNotification({
      kind: "item_completed",
      item: { id: "m2", type: "agentMessage", text: "---\nSecond." },
    });
    expect(run.answerText()).toBe("First.\n\nSecond.");
  });

  it("ignores non-message items and unrelated notification kinds", () => {
    const run = new CodexSideQuestionRun();
    run.handleNotification({
      kind: "item_completed",
      item: { id: "r1", type: "reasoning", text: "thinking" },
    });
    run.handleNotification({ kind: "exec_command_started", callId: "c1" });
    expect(run.answerText()).toBeNull();
  });

  it("reports a failed turn outcome", async () => {
    const run = new CodexSideQuestionRun();
    run.handleNotification({
      kind: "turn_completed",
      status: "failed",
      errorMessage: "model unavailable",
    });
    await expect(run.waitForCompletion(1_000)).resolves.toEqual({
      status: "failed",
      errorMessage: "model unavailable",
    });
  });

  it("rejects when the turn never completes in time", async () => {
    const run = new CodexSideQuestionRun();
    await expect(run.waitForCompletion(10)).rejects.toThrow(/side question/);
  });
});
