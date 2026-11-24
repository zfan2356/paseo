import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import type { AgentToolCallItem, StreamItem } from "@/types/stream";
import { createAgentReportProjection } from "./model";

function received(
  id: string,
  event: AgentMessage["event"] = "message",
  senderId = "reviewer",
  turnId: string | undefined = "turn-1",
  serverId = "host-1",
): AgentToolCallItem {
  return {
    kind: "tool_call",
    id,
    turnId,
    timestamp: new Date("2026-11-06T00:00:00Z"),
    payload: {
      source: "agent",
      data: {
        provider: "codex",
        callId: id,
        name: "agent_message",
        status: "completed",
        error: null,
        detail: { type: "plain_text", text: id },
        agentMessage: { event, sender: { id: senderId, serverId }, text: id },
      },
    },
  };
}

describe("agent report presentation", () => {
  it("combines adjacent reports and completion without changing canonical messages", () => {
    const tail = [received("report"), received("follow-up"), received("done", "finished")];
    const original = structuredClone(tail);
    const result = createAgentReportProjection()(tail, []);
    expect(result.tail).toMatchObject([
      {
        kind: "user_message",
        id: "report",
        text: "report\n\nfollow-up\n\ndone",
        agentReport: {
          entries: [
            { id: "report", message: { event: "message" } },
            { id: "follow-up", message: { event: "message" } },
            { id: "done", message: { event: "finished" } },
          ],
        },
      },
    ]);
    expect(result.hosts.get("follow-up")).toBe("report");
    expect(result.hosts.get("done")).toBe("report");
    expect(tail).toEqual(original);
  });

  it("joins a report across the retained/live boundary and keeps its identity", () => {
    const project = createAgentReportProjection();
    const tail = [received("report")];
    const head = [received("follow-up"), received("done", "finished")];
    const result = project(tail, head);
    expect(result.tail).toHaveLength(1);
    expect(result.head).toEqual([]);
    expect(result.hosts.get("follow-up")).toBe("report");
    expect(result.hosts.get("done")).toBe("report");
    expect(project(tail, head)).toBe(result);
    const replayed = project([...tail, ...head], []);
    expect(replayed.tail).toEqual(result.tail);
    expect(replayed.hosts.get("done")).toBe("report");
  });

  it.each(["errored", "permission-required", "closed"] as const)(
    "keeps %s visible as a separate event",
    (event) => {
      const notification = received("attention", event);
      const result = createAgentReportProjection()([received("report"), notification], []);
      expect(result.tail).toHaveLength(2);
      expect(result.tail[1]).toBe(notification);
    },
  );

  it("does not combine across senders, hosts, turns, or intervening human input", () => {
    const human: StreamItem = {
      kind: "user_message",
      id: "human",
      text: "Please continue",
      timestamp: new Date(),
      turnId: "turn-1",
    };
    const tail = [
      received("a"),
      received("b", "message", "other"),
      received("c", "message", "other", "turn-2"),
      received("d", "message", "other", "turn-2", "host-2"),
      human,
      received("e", "message", "other", "turn-2", "host-2"),
    ];
    const result = createAgentReportProjection()(tail, []);
    expect(result.tail.map((item) => item.id)).toEqual(tail.map((item) => item.id));
    expect(result.tail[4]).toBe(human);
  });

  it("keeps legacy turns and standalone completion notifications separate", () => {
    const first = received("legacy-1");
    const second = received("legacy-2");
    delete first.turnId;
    delete second.turnId;
    const completion = received("standalone", "finished");
    const result = createAgentReportProjection()([first, second, completion], []);
    expect(result.tail).toHaveLength(3);
    expect(result.tail[2]).toBe(completion);
  });

  it("reuses retained rows while unrelated assistant output streams", () => {
    const project = createAgentReportProjection();
    const tail = [received("report"), received("done", "finished")];
    const before = project(tail, []);
    const head: StreamItem[] = [
      { kind: "assistant_message", id: "answer", text: "Working", timestamp: new Date() },
    ];
    const after = project(tail, head);
    expect(after.tail).toBe(before.tail);
    expect(after.tail[0]).toBe(before.tail[0]);
    expect(after.head).toBe(head);
  });
});
