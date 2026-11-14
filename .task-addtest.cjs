const fs = require("fs");
const p = "packages/app/src/session-navigation/model.test.ts";
let s = fs.readFileSync(p, "utf8");
s += `
it("changes only session grouping when launch paths, bindings and manual project assignment differ", async () => {
  const { projectSessions, directorySessionGroupKey } = await import("./projection");
  const agents = [
    { ...sessionAgent, id: "main", cwd: "/repo" },
    { ...sessionAgent, id: "tree", cwd: "/worktrees/feature" },
    { ...sessionAgent, id: "notes", cwd: "/notes", title: "Research" },
  ];
  const projects: import("@/hooks/sidebar-workspaces-view-model").SidebarProjectEntry[] = ["repo", "manual"].map((id) => ({
    viewKey: id, projectName: id, projectKind: "git", iconWorkingDir: "/" + id, workspaces: [],
    hosts: [{ serverId: "host", projectId: id, iconWorkingDir: "/" + id, worktreeSupport: "supported" }],
  }));
  const snapshots = new Map<string, import("./contexts").ContextSnapshot>(agents.map((agent) => [
    "host:" + agent.id, { status: "ready", context: { ...context, agentId: agent.id,
      projectId: agent.id === "notes" ? "manual" : "repo", launchDirectory: "/historical-launch",
      linkedDirectories: [{ path: "/other", source: "manual", addedAt: "now" }] } },
  ]));
  const input = { serverId: "host", roots: agents, projects, snapshots, pinnedOrder: [], projectOrder: ["repo", "manual"],
    search: "", preferences: { sort: "created", labels: [], projects: [], group: "project" as const } };
  const before = structuredClone([...snapshots]);
  const byProject = projectSessions(input);
  expect(byProject.map((group) => [group.key, group.agents.map((agent) => agent.id)])).toEqual([
    ["repo", ["main", "tree"]], ["manual", ["notes"]],
  ]);
  const byDirectory = projectSessions({ ...input, preferences: { ...input.preferences, group: "directory" } });
  expect(byDirectory.map((group) => [group.key, group.agents.map((agent) => agent.id)])).toEqual(agents.map((agent) => [directorySessionGroupKey("host", agent.cwd), [agent.id]]));
  expect(byDirectory.flatMap((group) => group.agents)).toEqual(agents);
  expect([...snapshots]).toEqual(before);
  expect(directorySessionGroupKey("other-host", "/repo")).not.toEqual(directorySessionGroupKey("host", "/repo"));
});
`;
fs.writeFileSync(p, s);
