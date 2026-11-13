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

it("preserves global legacy pin order when hosts become ready in reverse order", async () => {
  const { mergeLegacySessionPins } = await import("./model");
  const a = mergeLegacySessionPins({
    order: [],
    ranks: {},
    edited: false,
    entries: [{ key: "A:one", workspaceRank: 1, createdAt: 0 }],
  });
  const b = mergeLegacySessionPins({
    order: a.order,
    ranks: a.ranks,
    edited: false,
    entries: [{ key: "B:two", workspaceRank: 0, createdAt: 0 }],
  });
  expect(b.order).toEqual(["B:two", "A:one"]);
  expect(
    mergeLegacySessionPins({
      order: a.order,
      ranks: a.ranks,
      edited: true,
      entries: [{ key: "B:two", workspaceRank: 0, createdAt: 0 }],
    }).order,
  ).toEqual(["A:one", "B:two"]);
});
it("hides cached context after the same host downgrades", async () => {
  const { contextSnapshotForHost } = await import("./model");
  expect(contextSnapshotForHost({ supported: true, snapshot: context })).toEqual(context);
  expect(contextSnapshotForHost({ supported: false, snapshot: context })).toBeUndefined();
});
it("surfaces a failed refresh without reading an old Git snapshot", async () => {
  const { readDirectoryFacts } = await import("./model");
  const reads: string[] = [];
  const client = {
    listDirectory: async () => {},
    checkoutRefresh: async () => ({
      success: false,
      error: { message: "Cannot read Git metadata" },
    }),
    getCheckoutStatus: async (path: string) => {
      reads.push(path);
      return "stale";
    },
  };
  await expect(
    readDirectoryFacts({ client, path: "/repo", refreshError: "Refresh failed" }),
  ).rejects.toThrow("Cannot read Git metadata");
  expect(reads).toEqual([]);
});
it("opens a bound directory PR using its actual URL without selecting the owning checkout", async () => {
  const { openChangesPullRequest } = await import("./model");
  const calls: string[] = [];
  openChangesPullRequest({
    directory: "/B",
    url: "https://github.com/B/repo/pull/7",
    openExternal: (url) => {
      calls.push(url);
    },
    openWorkspace: () => {
      calls.push("A");
    },
  });
  expect(calls).toEqual(["https://github.com/B/repo/pull/7"]);
});
it("uses checkout-root paths for nested directory changes and preserves non-Git roots", async () => {
  const { checkoutDirectory } = await import("./model");
  expect(
    checkoutDirectory({ directory: "/repo/sub", status: { isGit: true, repoRoot: "/repo" } }),
  ).toBe("/repo");
  expect(checkoutDirectory({ directory: "/notes", status: { isGit: false, repoRoot: null } })).toBe(
    "/notes",
  );
});
