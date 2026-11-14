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

const sessionAgent = {
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

it("sorts sessions by their own human prompts and normalizes stale running lifecycle", async () => {
  const { sortSessionAgents, sessionStatus } = await import("./projection");
  const a = { ...sessionAgent, id: "a", lastUserMessageAt: new Date("2026-01-02") };
  const b = { ...sessionAgent, id: "b", lastUserMessageAt: new Date("2026-01-03") };
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

it("shows the shortest unambiguous execution directory suffix", async () => {
  const { executionDirectoryLabel } = await import("./model");
  expect(executionDirectoryLabel("/works/slime", ["/works/slime", "/works/paseo"])).toBe("slime");
  expect(executionDirectoryLabel("/works/slime", ["/works/slime", "/other/slime"])).toBe(
    "works/slime",
  );
  expect(executionDirectoryLabel("C:\\dev\\slime", ["D:\\dev\\slime"])).toBe("C:\\dev\\slime");
  expect(executionDirectoryLabel("/", ["/works"])).toBe("/");
});

it("keeps all nine pins in one ordered section across project/directory grouping and filters", async () => {
  const { projectSessions, PINNED_SESSION_GROUP } = await import("./projection");
  const agents = Array.from({ length: 10 }, (_, index) => ({
    ...sessionAgent,
    id: String(index),
    title: `Session ${index}`,
  }));
  const snapshots = new Map<string, import("./contexts").ContextSnapshot>(
    agents.map((agent, index) => [
      `host:${agent.id}`,
      {
        status: "ready" as const,
        context: {
          ...context,
          agentId: agent.id,
          projectId: null,
          pinnedAt: index < 9 ? "2026-01-01" : null,
          sidebarLabelNames: index % 2 ? ["work"] : [],
        },
      },
    ]),
  );
  const input = {
    serverId: "host",
    roots: agents,
    snapshots,
    projects: [],
    pinnedOrder: agents
      .slice(0, 9)
      .toReversed()
      .map((agent) => `host:${agent.id}`),
    projectOrder: [],
    search: "",
    preferences: { sort: "lastPrompt", labels: [], projects: [], group: "project" as const },
  };
  expect(
    projectSessions(input).map((group) => [group.key, group.agents.map((agent) => agent.id)]),
  ).toEqual([
    [PINNED_SESSION_GROUP, ["8", "7", "6", "5", "4", "3", "2", "1", "0"]],
    ["ungrouped", ["9"]],
  ]);
  expect(
    projectSessions({
      ...input,
      preferences: { ...input.preferences, group: "directory", labels: ["work"] },
    }).map((group) => [group.key, group.agents.map((agent) => agent.id)]),
  ).toEqual([
    [PINNED_SESSION_GROUP, ["7", "5", "3", "1"]],
    [JSON.stringify(["directory", "host", "/repo"]), ["9"]],
  ]);
  snapshots.set("host:8", {
    status: "ready",
    context: { ...context, agentId: "8", pinnedAt: null },
  });
  expect(
    projectSessions({ ...input, search: "Session 8" }).map((group) => [
      group.key,
      group.agents.map((agent) => agent.id),
    ]),
  ).toEqual([["ungrouped", ["8"]]]);
});

it("changes only session grouping when launch paths, bindings and manual project assignment differ", async () => {
  const { projectSessions, directorySessionGroupKey } = await import("./projection");
  const agents = [
    { ...sessionAgent, id: "main", cwd: "/repo" },
    { ...sessionAgent, id: "tree", cwd: "/worktrees/feature" },
    { ...sessionAgent, id: "notes", cwd: "/notes", title: "Research" },
  ];
  const projects: import("@/hooks/sidebar-workspaces-view-model").SidebarProjectEntry[] = [
    "repo",
    "manual",
  ].map((id) => ({
    viewKey: id,
    projectName: id,
    projectKind: "git",
    iconWorkingDir: "/" + id,
    workspaces: [],
    hosts: [
      { serverId: "host", projectId: id, iconWorkingDir: "/" + id, worktreeSupport: "supported" },
    ],
  }));
  const snapshots = new Map<string, import("./contexts").ContextSnapshot>(
    agents.map((agent) => [
      "host:" + agent.id,
      {
        status: "ready",
        context: {
          ...context,
          agentId: agent.id,
          projectId: agent.id === "notes" ? "manual" : "repo",
          launchDirectory: "/historical-launch",
          linkedDirectories: [{ path: "/other", source: "manual", addedAt: "now" }],
        },
      },
    ]),
  );
  const input = {
    serverId: "host",
    roots: agents,
    projects,
    snapshots,
    pinnedOrder: [],
    projectOrder: ["repo", "manual"],
    search: "",
    preferences: { sort: "created", labels: [], projects: [], group: "project" as const },
  };
  const before = structuredClone([...snapshots]);
  const byProject = projectSessions(input);
  expect(byProject.map((group) => [group.key, group.agents.map((agent) => agent.id)])).toEqual([
    ["repo", ["main", "tree"]],
    ["manual", ["notes"]],
  ]);
  const byDirectory = projectSessions({
    ...input,
    preferences: { ...input.preferences, group: "directory" },
  });
  expect(byDirectory.map((group) => [group.key, group.agents.map((agent) => agent.id)])).toEqual(
    [agents[0], agents[2], agents[1]].map((agent) => [
      directorySessionGroupKey("host", agent.cwd),
      [agent.id],
    ]),
  );
  expect(byDirectory.flatMap((group) => group.agents)).toEqual([agents[0], agents[2], agents[1]]);
  expect([...snapshots]).toEqual(before);
  expect(directorySessionGroupKey("other-host", "/repo")).not.toEqual(
    directorySessionGroupKey("host", "/repo"),
  );
});
