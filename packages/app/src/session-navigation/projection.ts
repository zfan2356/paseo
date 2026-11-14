import { i18n } from "@/i18n/i18next";
import type { Agent } from "@/stores/session-store";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { ContextSnapshot } from "./contexts";
import { sessionDirectories, executionDirectoryLabel } from "./model";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";

interface SessionProjectionInput {
  serverId: string;
  roots: Agent[];
  snapshots: ReadonlyMap<string, ContextSnapshot | undefined>;
  projects: SidebarProjectEntry[];
  pinnedOrder: string[];
  projectOrder: string[];
  search: string;
  preferences: {
    sort: string;
    labels: readonly string[];
    projects: readonly string[];
    group: "project" | "directory";
  };
}
interface SessionGroup {
  key: string;
  name: string;
  agents: Agent[];
}
export function directorySessionGroupKey(serverId: string, cwd: string): string {
  return JSON.stringify(["directory", serverId, cwd]);
}
export const PINNED_SESSION_GROUP = "pinned-sessions";
export function sessionStatus(agent: Agent) {
  const lifecycle = agent.status === "running" ? "idle" : agent.status;
  const status = agent.turn.phase === "open" ? "running" : lifecycle;
  return deriveSidebarStateBucket({
    status,
    backgroundWork: agent.backgroundWork,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason,
  });
}
function contextFor(input: SessionProjectionInput, id: string) {
  const snapshot = input.snapshots.get(`${input.serverId}:${id}`);
  return snapshot?.status === "ready" ? snapshot.context : null;
}
function matchesFilters(
  input: SessionProjectionInput,
  agent: Agent,
  project: SidebarProjectEntry | undefined,
): boolean {
  const context = contextFor(input, agent.id);
  if (
    context &&
    input.preferences.projects.length &&
    !input.preferences.projects.includes(project?.viewKey ?? "")
  )
    return false;
  if (context && input.preferences.labels.length) {
    const labels = context.sidebarLabelNames.map(workspaceLabelKey);
    if (
      !input.preferences.labels.some((label) =>
        label === "" ? labels.length === 0 : labels.includes(label),
      )
    )
      return false;
  }
  const searchable = [
    agent.title ?? "",
    ...sessionDirectories(context).map((directory) => directory.path),
  ]
    .join(" ")
    .toLowerCase();
  return searchable.includes(input.search.toLowerCase());
}
export function projectSessions(input: SessionProjectionInput): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const agent of sortSessionAgents({
    agents: input.roots,
    snapshots: input.snapshots,
    pinnedOrder: input.pinnedOrder,
    sort: input.preferences.sort,
  })) {
    const context = contextFor(input, agent.id);
    const project = context
      ? input.projects.find((candidate) =>
          candidate.hosts.some(
            (host) => host.serverId === input.serverId && host.projectId === context.projectId,
          ),
        )
      : undefined;
    if (!matchesFilters(input, agent, project)) continue;
    let key = project?.viewKey ?? "ungrouped";
    let name =
      project?.projectName ??
      (context?.projectId
        ? i18n.t("sessionNavigation.projectUnavailable")
        : i18n.t("sessionNavigation.ungrouped"));
    if (context?.pinnedAt) {
      key = PINNED_SESSION_GROUP;
      name = i18n.t("sidebar.pinned.title");
    } else if (input.preferences.group === "directory") {
      key = directorySessionGroupKey(input.serverId, agent.cwd);
      name = executionDirectoryLabel(
        agent.cwd,
        input.roots.map((root) => root.cwd),
      );
    }
    const group = groups.get(key) ?? { key, name, agents: [] };
    group.agents.push(agent);
    groups.set(key, group);
  }
  const order = input.preferences.group === "project" ? input.projectOrder : [];
  return [...groups.values()].sort((a, b) => {
    const aIndex = order.indexOf(a.key);
    const bIndex = order.indexOf(b.key);
    if (a.key === PINNED_SESSION_GROUP) return -1;
    if (b.key === PINNED_SESSION_GROUP) return 1;
    return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex);
  });
}

export function sortSessionAgents(input: {
  agents: Agent[];
  snapshots: ReadonlyMap<string, ContextSnapshot | undefined>;
  pinnedOrder: string[];
  sort: string;
}): Agent[] {
  return [...input.agents].sort((a, b) => {
    const aSnapshot = input.snapshots.get(`${a.serverId}:${a.id}`);
    const bSnapshot = input.snapshots.get(`${b.serverId}:${b.id}`);
    const aPin = aSnapshot?.status === "ready" ? aSnapshot.context.pinnedAt : null;
    const bPin = bSnapshot?.status === "ready" ? bSnapshot.context.pinnedAt : null;
    if (Boolean(aPin) !== Boolean(bPin)) return aPin ? -1 : 1;
    if (aPin && bPin) {
      const aIndex = input.pinnedOrder.indexOf(`${a.serverId}:${a.id}`);
      const bIndex = input.pinnedOrder.indexOf(`${b.serverId}:${b.id}`);
      const order = (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex);
      if (order) return order;
    }
    const aTime = input.sort === "lastPrompt" ? (a.lastUserMessageAt ?? a.createdAt) : a.createdAt;
    const bTime = input.sort === "lastPrompt" ? (b.lastUserMessageAt ?? b.createdAt) : b.createdAt;
    return bTime.getTime() - aTime.getTime() || a.id.localeCompare(b.id);
  });
}
