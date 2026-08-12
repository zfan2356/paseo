import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { getIntermediateProcessDefaultExpanded, projectIntermediateProcess } from "./model";

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

function compaction(id: string, seed: number): StreamItem {
  return {
    kind: "compaction",
    id,
    timestamp: timestamp(seed),
    status: "completed",
    trigger: "auto",
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

  it("keeps context compaction inside one intermediate process group", () => {
    const tail = [
      user("user", 1),
      assistant("intro", 2),
      tool("before-compaction", 3),
      compaction("compaction", 4),
      assistant("continued", 5),
      tool("after-compaction", 6),
      assistant("final", 7),
    ];

    const projection = projectIntermediateProcess({ tail, head: [], isTurnActive: false });

    expect(projection.tail.map((item) => item.id)).toEqual(["user", "intro", "final"]);
    expect(projection.groupsByHostId.size).toBe(1);
    expect(projection.groupsByHostId.get("intro")?.items.map((item) => item.id)).toEqual([
      "intro",
      "before-compaction",
      "compaction",
      "continued",
      "after-compaction",
    ]);
  });

  it("marks a failed completed group as an error without forcing it open", () => {
    const projection = projectIntermediateProcess({
      tail: [user("user", 1), thought("thought", 2), tool("failed", 3, "failed")],
      head: [],
      isTurnActive: false,
    });

    const group = projection.groupsByHostId.get("thought");
    if (!group) {
      throw new Error("Expected a failed intermediate-process group");
    }
    expect(group).toMatchObject({
      hasError: true,
      isActive: false,
    });
    expect(getIntermediateProcessDefaultExpanded(group)).toBe(false);
  });

  it("does not fold assistant-only turns", () => {
    const tail = [user("user", 1), assistant("answer", 2)];
    const projection = projectIntermediateProcess({ tail, head: [], isTurnActive: false });

    expect(projection.tail).toBe(tail);
    expect(projection.groupsByHostId.size).toBe(0);
  });
});
