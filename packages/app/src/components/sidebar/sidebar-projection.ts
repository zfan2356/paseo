import type { TFunction } from "i18next";
import { buildStatusGroups } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import {
  resolveSidebarProjectIconTargets,
  type SidebarProjectIconTarget,
} from "@/utils/sidebar-project-row-model";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";
import { statusWorkspaceGroups, type SidebarWorkspaceGroup } from "./sidebar-labels";
import { executionDirectoryLabel } from "@/session-navigation/model";

export type SidebarCheckoutIdentity =
  | { isGit: false }
  | { isGit: true; repoRoot: string; mainRepoRoot?: string | null };

export function sidebarCheckoutIdentityKey(serverId: string, directory: string): string {
  return JSON.stringify([serverId, directory]);
}

export function groupSidebarWorktrees(
  projects: SidebarProjectEntry[],
  checkouts: ReadonlyMap<string, SidebarCheckoutIdentity>,
): SidebarProjectEntry[] {
  const groups = new Map<string, SidebarProjectEntry>();
  const paths = projects.flatMap((project) => project.hosts.map((host) => host.iconWorkingDir));
  for (const project of projects) {
    const host = project.hosts.length === 1 ? project.hosts[0] : undefined;
    const checkout = host
      ? checkouts.get(sidebarCheckoutIdentityKey(host.serverId, host.iconWorkingDir))
      : undefined;
    // A repository subdirectory is an independent project, not a linked worktree.
    const mainRoot =
      checkout?.isGit && checkout.repoRoot === host?.iconWorkingDir
        ? (checkout.mainRepoRoot ?? checkout.repoRoot)
        : null;
    const mainProject = mainRoot
      ? projects.find((candidate) =>
          candidate.hosts.some(
            (target) => target.serverId === host?.serverId && target.iconWorkingDir === mainRoot,
          ),
        )
      : undefined;
    const key =
      mainProject?.viewKey ??
      (mainRoot && host ? sidebarCheckoutIdentityKey(host.serverId, mainRoot) : project.viewKey);
    const existing = groups.get(key);
    if (existing) {
      groups.set(key, { ...existing, workspaces: [...existing.workspaces, ...project.workspaces] });
      continue;
    }
    const representative = mainProject ?? project;
    groups.set(key, {
      ...representative,
      projectName:
        mainRoot && !mainProject
          ? executionDirectoryLabel(mainRoot, paths)
          : representative.projectName,
      workspaces: project.workspaces,
    });
  }
  return [...groups.values()];
}

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  workspaceGroups: SidebarWorkspaceGroup[];
  /**
   * The project icons this projection needs fetched, keyed by `projectViewKey` — one per project,
   * whatever the mode groups by. It sits here rather than beside `useProjectIcons` in the list
   * because it is the same `projects` the rows above are projected from: a mode that renders a
   * row can only ever ask for an icon this list already covers. It used to be derived in the
   * list, under a `groupMode === "status"` gate written when status was the only mode that put
   * icons on rows.
   */
  projectIconTargets: SidebarProjectIconTarget[];
  shortcutModel: SidebarShortcutModel;
}

export interface SidebarProjectionInput {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  pinnedWorkspaceOrder: string[];
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByViewKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedWorkspaceGroupKeys: ReadonlySet<string>;
  t: TFunction;
}

export function buildSidebarProjection(input: SidebarProjectionInput): SidebarProjection {
  const pinnedGroups = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
    pinnedWorkspaceOrder: input.pinnedWorkspaceOrder,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const unpinnedWorkspaces = Array.from(input.workspaceEntriesByKey.values()).filter(
    (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
  );
  // One switch decides both what the list groups by and what the keyboard shortcuts walk, so the
  // two cannot disagree and a new grouping mode is a compile error here rather than a silent
  // fall-through to the project rows.
  const workspaceGroups = buildWorkspaceGroups(input, unpinnedWorkspaces);

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  if (input.groupMode === "project") {
    sections.push(
      ...pinnedGroups.unpinnedProjects.map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.collapsedProjectKeys.has(project.viewKey),
      })),
    );
  } else {
    sections.push(
      ...workspaceGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.collapsedWorkspaceGroupKeys.has(group.key),
      })),
    );
  }

  return {
    pinnedGroups,
    workspaceGroups,
    projectIconTargets: resolveSidebarProjectIconTargets(input.projects),
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

/** Project mode keeps its project headers and groups nothing; status mode groups the rows. */
function buildWorkspaceGroups(
  input: SidebarProjectionInput,
  unpinnedWorkspaces: SidebarWorkspaceEntry[],
): SidebarWorkspaceGroup[] {
  switch (input.groupMode) {
    case "project":
      return [];
    case "status":
      return statusWorkspaceGroups(
        buildStatusGroups(unpinnedWorkspaces, input.projectNamesByViewKey, input.t),
      );
  }
}
