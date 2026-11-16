import { i18n } from "@/i18n/i18next";
import { describe, expect, it } from "vitest";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
  SidebarWorkspacePlacement,
} from "@/hooks/use-sidebar-workspaces-list";
import {
  buildSidebarProjection,
  groupSidebarWorktrees,
  orderSidebarWorktreeGroups,
  sidebarCheckoutIdentityKey,
  type SidebarCheckoutIdentity,
} from "./sidebar-projection";

function makeWorkspace(
  id: string,
  statusBucket: SidebarWorkspaceEntry["statusBucket"] = "done",
  labels: string[] = [],
  projectViewKey = "project",
) {
  const placement: SidebarWorkspacePlacement = {
    workspaceKey: `srv:${id}`,
    serverId: "srv",
    workspaceId: id,
    projectViewKey,
    projectName: "Project",
    projectKind: "git",
    workspaceKind: "worktree",
    name: id,
  };
  const entry: SidebarWorkspaceEntry = {
    ...placement,
    workspaceDirectory: "",
    workspaceDirectoryLabel: "",
    title: null,
    currentBranch: null,
    statusBucket,
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    prHint: null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    labels,
  };
  return { placement, entry };
}

function makeProject(
  workspaces: SidebarWorkspacePlacement[],
  viewKey = "project",
): SidebarProjectEntry {
  return {
    viewKey,
    projectName: "Project",
    projectKind: "git",
    iconWorkingDir: `/repo/${viewKey}`,
    hosts: [
      {
        serverId: "srv",
        projectId: viewKey,
        iconWorkingDir: `/repo/${viewKey}`,
        worktreeSupport: "supported" as const,
      },
    ],
    workspaces,
  };
}

describe("worktree sidebar grouping", () => {
  function project(directory: string, serverId = "srv") {
    const viewKey = `${serverId}:${directory}`;
    return {
      ...makeProject([makeWorkspace(viewKey, "running", [], viewKey).placement], viewKey),
      projectName: directory.split("/").at(-1) ?? directory,
      iconWorkingDir: directory,
      hosts: [
        {
          serverId,
          projectId: viewKey,
          iconWorkingDir: directory,
          worktreeSupport: "supported" as const,
        },
      ],
    };
  }
  function facts(entries: Array<[string, string, SidebarCheckoutIdentity]>) {
    return new Map(
      entries.map(([host, directory, status]) => [
        sidebarCheckoutIdentityKey(host, directory),
        status,
      ]),
    );
  }

  it("applies the existing time sorts across merged directories", () => {
    const main = makeWorkspace("main", "done", [], "main");
    const older = makeWorkspace("older", "done", [], "linked");
    const newer = makeWorkspace("newer", "done", [], "linked");
    const grouped = [makeProject([main.placement, older.placement, newer.placement], "main")];
    const entries = new Map([
      [
        main.entry.workspaceKey,
        { ...main.entry, createdAt: new Date(2000), lastUserMessageAt: new Date(3000) },
      ],
      [
        older.entry.workspaceKey,
        { ...older.entry, createdAt: new Date(1000), lastUserMessageAt: new Date(5000) },
      ],
      [
        newer.entry.workspaceKey,
        { ...newer.entry, createdAt: new Date(3000), lastUserMessageAt: new Date(4000) },
      ],
    ]);
    expect(
      orderSidebarWorktreeGroups(grouped, entries, "created", {})[0].workspaces.map(
        (workspace) => workspace.workspaceId,
      ),
    ).toEqual(["newer", "main", "older"]);
    expect(
      orderSidebarWorktreeGroups(grouped, entries, "lastPrompt", {})[0].workspaces.map(
        (workspace) => workspace.workspaceId,
      ),
    ).toEqual(["older", "newer", "main"]);
  });

  it("honors the saved merged drag order without writing directory orders", () => {
    const main = makeWorkspace("main", "done", [], "main");
    const linked = makeWorkspace("linked", "done", [], "linked");
    const grouped = [makeProject([main.placement, linked.placement], "main")];
    const orders = {
      main: [linked.entry.workspaceKey, main.entry.workspaceKey],
      linked: [linked.entry.workspaceKey],
    };
    const before = structuredClone(orders);
    expect(orderSidebarWorktreeGroups(grouped, new Map(), "manual", orders)[0].workspaces).toEqual([
      linked.placement,
      main.placement,
    ]);
    expect(orders).toEqual(before);
    expect(grouped[0].workspaces).toEqual([main.placement, linked.placement]);
  });

  it("only moves linked worktrees into the main checkout's existing list, keeping row identities", () => {
    const linked = project("/outside/fix");
    const main = project("/repo");
    const second = project("/outside/feature");
    const before = structuredClone([linked, main, second]);
    const grouped = groupSidebarWorktrees(
      [linked, main, second],
      facts([
        ["srv", "/outside/fix", { isGit: true, repoRoot: "/outside/fix", mainRepoRoot: "/repo" }],
        ["srv", "/repo", { isGit: true, repoRoot: "/repo" }],
        [
          "srv",
          "/outside/feature",
          { isGit: true, repoRoot: "/outside/feature", mainRepoRoot: "/repo" },
        ],
      ]),
    );
    expect(grouped).toEqual([
      { ...main, workspaces: [linked.workspaces[0], main.workspaces[0], second.workspaces[0]] },
    ]);
    expect(grouped[0].workspaces[0]).toBe(linked.workspaces[0]);
    expect([linked, main, second]).toEqual(before);
  });

  it("keeps names, path prefixes, repository subdirectories, unavailable facts and hosts independent", () => {
    const projects = [
      project("/a/repo"),
      project("/b/repo"),
      project("/a/repo/sub"),
      project("/notes"),
      project("/unknown"),
      project("/a/repo", "other"),
    ];
    const grouped = groupSidebarWorktrees(
      projects,
      facts([
        ["srv", "/a/repo", { isGit: true, repoRoot: "/a/repo" }],
        ["srv", "/b/repo", { isGit: true, repoRoot: "/b/repo" }],
        ["srv", "/a/repo/sub", { isGit: true, repoRoot: "/a/repo" }],
        ["srv", "/notes", { isGit: false }],
        ["other", "/a/repo", { isGit: true, repoRoot: "/a/repo" }],
      ]),
    );
    expect(grouped).toEqual(projects);
  });

  it("uses the Git main checkout even when it has no registered project or a branch named main", () => {
    const first = project("/fix");
    const second = project("/main");
    expect(
      groupSidebarWorktrees(
        [first, second],
        facts([
          ["srv", "/fix", { isGit: true, repoRoot: "/fix", mainRepoRoot: "/real-checkout" }],
          ["srv", "/main", { isGit: true, repoRoot: "/main", mainRepoRoot: "/real-checkout" }],
        ]),
      ),
    ).toEqual([
      {
        ...first,
        projectName: "real-checkout",
        workspaces: [...first.workspaces, ...second.workspaces],
      },
    ]);
  });

  it("does not duplicate a main project while its own Git facts are still loading", () => {
    const linked = project("/fix");
    const main = project("/repo");
    expect(
      groupSidebarWorktrees(
        [linked, main],
        facts([["srv", "/fix", { isGit: true, repoRoot: "/fix", mainRepoRoot: "/repo" }]]),
      ),
    ).toEqual([{ ...main, workspaces: [...linked.workspaces, ...main.workspaces] }]);
  });
});

function projectionInput(options?: {
  groupMode?: "project" | "status";
  pinnedCollapsed?: boolean;
}) {
  const pinned = makeWorkspace("pinned", "running");
  const unpinned = makeWorkspace("unpinned", "needs_input");
  return {
    projects: [makeProject([pinned.placement, unpinned.placement])],
    pinnedKeys: {
      pinnedWorkspaceKeys: [pinned.placement.workspaceKey],
      pinnedAtByKey: { [pinned.placement.workspaceKey]: "2026-07-12T12:00:00.000Z" },
    },
    pinnedWorkspaceOrder: [],
    workspaceEntriesByKey: new Map([
      [pinned.entry.workspaceKey, pinned.entry],
      [unpinned.entry.workspaceKey, unpinned.entry],
    ]),
    projectNamesByViewKey: new Map([["project", "Project"]]),
    groupMode: options?.groupMode ?? ("project" as const),
    pinnedCollapsed: options?.pinnedCollapsed ?? false,
    collapsedProjectKeys: new Set<string>(),
    collapsedWorkspaceGroupKeys: new Set<string>(),
    t: i18n.t,
  };
}

/**
 * Two projects, one workspace each, both labelled — so every grouping mode puts rows from more
 * than one project on screen, and a mode that asked for fewer icons than it renders would show it.
 */
function twoProjectInput(groupMode: "project" | "status") {
  const first = makeWorkspace("first", "running", ["Urgent"], "project");
  const second = makeWorkspace("second", "needs_input", ["Backend"], "other-project");
  return {
    ...projectionInput({ groupMode }),
    projects: [makeProject([first.placement]), makeProject([second.placement], "other-project")],
    pinnedKeys: { pinnedWorkspaceKeys: [], pinnedAtByKey: {} },
    workspaceEntriesByKey: new Map([
      [first.entry.workspaceKey, first.entry],
      [second.entry.workspaceKey, second.entry],
    ]),
    projectNamesByViewKey: new Map([
      ["project", "Project"],
      ["other-project", "Other project"],
    ]),
  };
}

describe("buildSidebarProjection", () => {
  // The rule that outlived the bug it was written for: a project icon is fetched per project, so
  // whatever a mode groups by, the rows it produces can only reference projects already covered.
  for (const groupMode of ["project", "status"] as const) {
    it(`covers every row ${groupMode} grouping renders with a project icon target`, () => {
      const projection = buildSidebarProjection(twoProjectInput(groupMode));
      const covered = new Set(projection.projectIconTargets.map((target) => target.projectViewKey));

      // Every leading visual the sidebar can paint from this projection: pinned rows, grouped
      // rows, project headers and the rows under them.
      const renderedProjectViewKeys = new Set<string>();
      for (const entry of projection.pinnedGroups.pinnedChats) {
        renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const group of projection.workspaceGroups) {
        for (const entry of group.rows) renderedProjectViewKeys.add(entry.projectViewKey);
      }
      for (const project of projection.pinnedGroups.unpinnedProjects) {
        renderedProjectViewKeys.add(project.viewKey);
        for (const entry of project.workspaces) renderedProjectViewKeys.add(entry.projectViewKey);
      }

      expect([...renderedProjectViewKeys].sort()).toEqual(["other-project", "project"]);
      expect([...renderedProjectViewKeys].filter((viewKey) => !covered.has(viewKey))).toEqual([]);
    });
  }

  it("uses one pin-aware projection for project rows and shortcut order", () => {
    const projection = buildSidebarProjection(projectionInput());

    expect(projection.pinnedGroups.pinnedChats.map((entry) => entry.workspaceId)).toEqual([
      "pinned",
    ]);
    const remainingProject = projection.pinnedGroups.unpinnedProjects[0];
    expect(remainingProject?.workspaces.map((entry) => entry.workspaceId)).toEqual(["unpinned"]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("keeps pinned chats above status groups and removes them from those groups", () => {
    const projection = buildSidebarProjection(projectionInput({ groupMode: "status" }));

    expect(projection.workspaceGroups.map((group) => group.key)).toEqual(["needs_input"]);
    expect(projection.workspaceGroups[0]?.rows.map((entry) => entry.workspaceId)).toEqual([
      "unpinned",
    ]);
    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "pinned" },
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });

  it("does not number pinned chats while the pinned section is collapsed", () => {
    const projection = buildSidebarProjection(
      projectionInput({ groupMode: "status", pinnedCollapsed: true }),
    );

    expect(projection.shortcutModel.shortcutTargets).toEqual([
      { serverId: "srv", workspaceId: "unpinned" },
    ]);
  });
});
