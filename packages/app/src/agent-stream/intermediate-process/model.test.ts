import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { projectIntermediateProcess } from "./model";

function timestamp(seed: number): Date {
  return new Date(`2026-01-01T00:00:${seed.toString().padStart(2, "0")}.000Z`);
}

function user(id: string, seed: number): StreamItem {
  return { kind: "user_message", id, text: id, timestamp: timestamp(seed) };
}

function assistant(id: string, seed: number): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp: timestamp(seed) };
}

function thought(id: string, seed: number, status: "loading" | "ready" = "ready"): StreamItem {
  return { kind: "thought", id, text: id, status, timestamp: timestamp(seed) };
}

function tool(
  id: string,
  seed: number,
  status: "executing" | "completed" | "failed" = "completed",
): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: timestamp(seed),
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "shell",
        arguments: "echo test",
        status,
      },
    },
  };
}

describe("projectIntermediateProcess", () => {
  it("collapses intermediate messages and steps while preserving the final answer", () => {
    const tail = [
      user("user", 1),
      assistant("intro", 2),
      thought("thought", 3),
      tool("tool", 4),
      assistant("progress", 5),
      tool("verify", 6),
      assistant("final", 7),
    ];

    const projection = projectIntermediateProcess({ tail, head: [], isTurnActive: false });

    expect(projection.tail.map((item) => item.id)).toEqual(["user", "intro", "final"]);
    expect(projection.groupsByHostId.get("intro")).toMatchObject({
      hostId: "intro",
      isActive: false,
      hasError: false,
      stepCount: 3,
    });
    expect(projection.groupsByHostId.get("intro")?.items.map((item) => item.id)).toEqual([
      "intro",
      "thought",
      "tool",
      "progress",
      "verify",
    ]);
  });

  it("keeps a cross-boundary active group hosted in history and marks it for revision", () => {
    const tail = [user("user", 1), assistant("intro", 2), thought("thought", 3)];
    const head = [tool("running", 4, "executing")];

    const projection = projectIntermediateProcess({ tail, head, isTurnActive: true });

    expect(projection.tail.map((item) => item.id)).toEqual(["user", "intro"]);
    expect(projection.head).toHaveLength(0);
    expect(projection.groupsByHostId.get("intro")?.isActive).toBe(true);
    expect(projection.historyGroupUpdatesByHostId.has("intro")).toBe(true);
  });

  it("forces failed process groups into the error presentation", () => {
    const projection = projectIntermediateProcess({
      tail: [user("user", 1), thought("thought", 2), tool("failed", 3, "failed")],
      head: [],
      isTurnActive: false,
    });

    expect(projection.groupsByHostId.get("thought")).toMatchObject({
      hasError: true,
      isActive: false,
    });
  });

  it("does not fold assistant-only turns", () => {
    const tail = [user("user", 1), assistant("answer", 2)];
    const projection = projectIntermediateProcess({ tail, head: [], isTurnActive: false });

    expect(projection.tail).toBe(tail);
    expect(projection.groupsByHostId.size).toBe(0);
  });
});
