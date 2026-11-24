import { describe, expect, it } from "vitest";
import { deriveMenuBarSnapshot, type MenuBarAgent, type MenuBarHost } from "./status";
import { MenuBarSnapshotSchema } from "../../../../desktop/src/features/menu-bar/state";

const host: MenuBarHost = {
  serverId: "local",
  label: "Mac",
  connectionStatus: "online",
  agentDirectoryStatus: "ready",
};
function agent(overrides: Partial<MenuBarAgent> = {}): MenuBarAgent {
  return {
    id: "task",
    serverId: "local",
    title: "Test task",
    status: "idle",
    turn: { phase: "idle", cancellationRequestId: null },
    pendingPermissionCount: 0,
    archivedAt: null,
    requiresAttention: false,
    attentionReason: null,
    cwd: "/workspace/paseo",
    provider: "codex",
    lastActivityAt: new Date(1_700_000_000_000),
    ...overrides,
  };
}

describe("menu bar task snapshot", () => {
  it("counts mutually exclusive states and puts approval before running and unread completion", () => {
    const snapshot = deriveMenuBarSnapshot(
      [
        agent({ id: "done", requiresAttention: true, attentionReason: "finished" }),
        agent({ id: "run", status: "running" }),
        agent({ id: "fail", status: "error" }),
        agent({ id: "wait", status: "running", pendingPermissionCount: 3 }),
        agent({ id: "idle" }),
      ],
      [host],
    );
    expect(snapshot).toMatchObject({
      hosts: [{ serverId: "local", label: "Mac", status: "ready" }],
      running: 1,
      waiting: 1,
      failed: 1,
      finished: 1,
      tasks: [
        { serverId: "local", agentId: "wait", title: "Test task", status: "waiting" },
        { serverId: "local", agentId: "fail", title: "Test task", status: "failed" },
        { serverId: "local", agentId: "run", title: "Test task", status: "running" },
        { serverId: "local", agentId: "done", title: "Test task", status: "finished" },
      ],
    });
    expect(MenuBarSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("excludes archived, removed, offline and syncing hosts instead of reporting cached work", () => {
    const snapshot = deriveMenuBarSnapshot(
      [
        agent({ archivedAt: new Date(), status: "running" }),
        agent({ serverId: "removed", status: "error" }),
        agent({ serverId: "offline", status: "running" }),
        agent({ serverId: "syncing", status: "running" }),
      ],
      [
        host,
        { ...host, serverId: "offline", connectionStatus: "offline" },
        { ...host, serverId: "syncing", agentDirectoryStatus: "revalidating" },
      ],
    );
    expect(snapshot.tasks).toEqual([]);
    expect([snapshot.running, snapshot.waiting, snapshot.failed, snapshot.finished]).toEqual([
      0, 0, 0, 0,
    ]);
    expect(snapshot.hosts.map((entry) => entry.status)).toEqual(["ready", "offline", "syncing"]);
  });

  it("counts initializing and open turns as active even before lifecycle status catches up", () => {
    const snapshot = deriveMenuBarSnapshot(
      [
        agent({ id: "initial", status: "initializing" }),
        agent({
          turn: { phase: "open", turnId: "turn", startedAt: null, cancellationRequestId: null },
        }),
      ],
      [host],
    );
    expect(snapshot.running).toBe(2);
  });

  it("uses attention reasons for permissions and errors, and drops read completions", () => {
    const snapshot = deriveMenuBarSnapshot(
      [
        agent({ id: "permission", attentionReason: "permission" }),
        agent({ id: "error", attentionReason: "error" }),
        agent({ id: "read", attentionReason: "finished", requiresAttention: false }),
      ],
      [host],
    );
    expect([snapshot.waiting, snapshot.failed, snapshot.finished]).toEqual([1, 1, 0]);
  });

  it("deduplicates per host, caps menu length, and retains full counts", () => {
    const agents = Array.from({ length: 20 }, (_, index) =>
      agent({ id: `${index}`, status: "running" }),
    );
    const snapshot = deriveMenuBarSnapshot(
      [
        ...agents,
        agents[0],
        agent({
          serverId: "remote",
          id: "0",
          pendingPermissionCount: 1,
          title: "",
        }),
      ],
      [host, { ...host, serverId: "remote" }],
    );
    expect(snapshot.running).toBe(20);
    expect(snapshot.waiting).toBe(1);
    expect(snapshot.tasks).toHaveLength(13);
    expect(snapshot.tasks[0]).toMatchObject({
      serverId: "remote",
      agentId: "0",
      status: "waiting",
      title: "Untitled task",
    });
  });

  it("includes actual error context and keeps completed tasks when running tasks fill their group", () => {
    const snapshot = deriveMenuBarSnapshot(
      [
        ...Array.from({ length: 20 }, (_, index) => agent({ id: `${index}`, status: "running" })),
        agent({ id: "done", requiresAttention: true, attentionReason: "finished" }),
        agent({ id: "broken", status: "error", lastError: "Connection refused\nPlease reconnect" }),
      ],
      [host],
    );
    expect(snapshot.tasks.find((task) => task.agentId === "done")?.summary).toBe("codex · paseo");
    expect(snapshot.tasks.find((task) => task.agentId === "broken")).toMatchObject({
      summary: "Connection refused Please reconnect",
      updatedAt: 1_700_000_000_000,
    });
    expect(snapshot.tasks).toHaveLength(14);
    expect(snapshot.running).toBe(20);
  });
});
