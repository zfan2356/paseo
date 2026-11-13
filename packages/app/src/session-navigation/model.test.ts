import { describe, expect, it } from "vitest";
import { sessionDirectories, visibleSessionAgents, groupDirectories } from "./model";
import type { SessionContext } from "@getpaseo/protocol/session-context";

const context: SessionContext = {
  agentId: "a",
  launchDirectory: "/works",
  projectId: null,
  pinnedAt: null,
  sidebarLabelNames: [],
  linkedDirectories: [{ path: "/repo", source: "manual", addedAt: "now" }],
  autoLinkDirectories: true,
  excludedDirectoryPaths: [],
};
describe("session navigation", () => {
  it("keeps a shared directory under each session without inventing old-host context", () => {
    expect(sessionDirectories(context)).toEqual([
      { path: "/works", launch: true },
      { path: "/repo", launch: false },
    ]);
    expect(sessionDirectories(null)).toEqual([]);
    expect(sessionDirectories({ ...context, agentId: "b" })).toEqual(sessionDirectories(context));
  });
  it("shows two roots in one workspace and a cross-workspace child, hiding helpers", () => {
    const agents = new Map([
      ["a", { id: "a", workspaceId: "w", parentAgentId: null }],
      ["b", { id: "b", workspaceId: "w", parentAgentId: null }],
      ["c", { id: "c", workspaceId: "w", parentAgentId: "a" }],
      ["d", { id: "d", workspaceId: "other", parentAgentId: "a" }],
      ["helper", { id: "helper", workspaceId: "w", parentAgentId: null, background: true }],
    ]);
    expect(visibleSessionAgents(agents).map((a) => a.id)).toEqual(["a", "b", "d"]);
  });
  it("groups worktrees using Git facts and preserves non-Git and unavailable paths", () => {
    expect(
      groupDirectories([
        { path: "/repo", launch: true, repository: "/repo" },
        { path: "/wt", launch: false, repository: "/repo" },
        { path: "/notes", launch: false, repository: null },
        { path: "/gone", launch: false, repository: null },
      ]),
    ).toEqual([
      {
        repository: "/repo",
        directories: [
          { path: "/repo", launch: true, repository: "/repo" },
          { path: "/wt", launch: false, repository: "/repo" },
        ],
      },
      {
        repository: null,
        directories: [
          { path: "/notes", launch: false, repository: null },
          { path: "/gone", launch: false, repository: null },
        ],
      },
    ]);
  });
});

it("sorts sessions by their own human prompts and normalizes stale running lifecycle", async () => {
  const { sortSessionAgents, sessionStatus } = await import("./projection");
  const base = {
    serverId: "host",
    provider: "codex",
    status: "running",
    turn: { phase: "idle", cancellationRequestId: null },
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-05"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-01-05"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: null,
    cwd: "/repo",
    workspaceId: "shared",
    model: null,
    parentAgentId: null,
    labels: {},
  } satisfies Omit<import("@/stores/session-store").Agent, "id">;
  const a = { ...base, id: "a", lastUserMessageAt: new Date("2026-01-02") };
  const b = { ...base, id: "b", lastUserMessageAt: new Date("2026-01-03") };
  expect(
    sortSessionAgents({
      agents: [a, b],
      snapshots: new Map(),
      pinnedOrder: [],
      sort: "lastPrompt",
    }).map((agent) => agent.id),
  ).toEqual(["b", "a"]);
  expect(sessionStatus(a)).toBe("done");
});

it("moves pinned sessions without reordering unrelated sessions", async () => {
  const { movePinnedSession } = await import("./model");
  expect(movePinnedSession(["a", "other", "b"], "b", "a")).toEqual(["b", "other", "a"]);
});
