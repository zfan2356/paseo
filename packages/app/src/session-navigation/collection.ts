import { resolveActiveProjectFilters } from "@/components/sidebar/sidebar-project-filter";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useShallow } from "zustand/shallow";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  getHostRuntimeStore,
  useHosts,
  useHostRuntimeConnectionStatuses,
} from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useSidebarOrderStore } from "@/stores/sidebar-order-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import { visibleSessionAgents } from "./model";
import { projectSessions, sortSessionAgents } from "./projection";
import { useSessionContexts } from "./contexts";
import { useSessionNavigationPreferences } from "./preferences";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { useHostBadges } from "@/hosts/use-host-badges";

interface HostSource {
  serverId: string;
  agents: Map<string, Agent>;
  workspaces: Map<string, WorkspaceDescriptor>;
  supported: boolean | null;
  hydrated: boolean;
  focusedAgentId: string | null;
}
const EMPTY_AGENTS = new Map<string, Agent>();
const EMPTY_WORKSPACES = new Map<string, WorkspaceDescriptor>();
function sourcesEqual(a: HostSource[], b: HostSource[]) {
  return (
    a.length === b.length &&
    a.every((source, index) => {
      const other = b[index];
      return (
        source.serverId === other.serverId &&
        source.agents === other.agents &&
        source.workspaces === other.workspaces &&
        source.supported === other.supported &&
        source.hydrated === other.hydrated &&
        source.focusedAgentId === other.focusedAgentId
      );
    })
  );
}
export function useSessionNavigationCollection({
  projects,
  enabled,
}: {
  projects: SidebarProjectEntry[];
  enabled: boolean;
}) {
  const hosts = useHosts();
  const preferences = useSidebarViewStore(
    useShallow((state) => ({
      sort: state.workspaceSort,
      labels: state.labelFilter.labels,
      projects: state.projectFilters,
      group: state.groupMode,
      showBackground: state.showBackground,
      hostFilters: state.hostFilters,
    })),
  );
  const visibleHosts = useMemo(
    () =>
      hosts.filter(
        (host) =>
          preferences.hostFilters.length === 0 || preferences.hostFilters.includes(host.serverId),
      ),
    [hosts, preferences.hostFilters],
  );
  const serverIds = useMemo(() => visibleHosts.map((host) => host.serverId), [visibleHosts]);
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const sources = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      serverIds.map((serverId) => {
        const session = state.sessions[serverId];
        return {
          serverId,
          agents: session?.agents ?? EMPTY_AGENTS,
          workspaces: session?.workspaces ?? EMPTY_WORKSPACES,
          supported: session?.serverInfo
            ? session.serverInfo.features?.sessionContext === true
            : null,
          hydrated: session?.hasHydratedAgents === true,
          focusedAgentId: session?.focusedAgentId ?? null,
        };
      }),
    sourcesEqual,
  );
  const roots = useMemo(
    () =>
      sources.map((source) => ({
        source,
        agents: visibleSessionAgents(source.agents).filter(
          (agent) =>
            preferences.showBackground ||
            !source.workspaces.get(agent.workspaceId ?? "")?.background,
        ),
      })),
    [sources, preferences.showBackground],
  );
  const targetIdentity = JSON.stringify(
    roots.map(({ source, agents }) => ({
      serverId: source.serverId,
      supported: source.supported,
      ids: agents.map((agent) => agent.id).sort(),
    })),
  );
  const targets = useMemo(() => {
    const identity: Array<{ serverId: string; supported: boolean; ids: string[] }> =
      JSON.parse(targetIdentity);
    return identity.flatMap((host) =>
      host.ids.map((agentId) => ({
        serverId: host.serverId,
        agentId,
        supported: host.supported === true,
        client: getHostRuntimeStore().getClient(host.serverId),
        enabled: enabled && host.supported === true && statuses.get(host.serverId) === "online",
      })),
    );
  }, [targetIdentity, statuses, enabled]);
  const snapshots = useSessionContexts(targets);
  const pinsHydrated = useSyncExternalStore(
    (listener) => useSessionNavigationPreferences.persist.onFinishHydration(listener),
    () => useSessionNavigationPreferences.persist.hasHydrated(),
    () => false,
  );
  const orderHydrated = useSyncExternalStore(
    (listener) => useSidebarOrderStore.persist.onFinishHydration(listener),
    () => useSidebarOrderStore.persist.hasHydrated(),
    () => false,
  );
  const pinnedOrder = useSessionNavigationPreferences((state) => state.pinnedOrder);
  const migratePins = useSessionNavigationPreferences((state) => state.migratePins);
  const oldPinnedOrder = useSidebarOrderStore((state) => state.pinnedWorkspaceOrder);
  const search = useSessionNavigationPreferences((state) => state.search);
  const projectOrder = useSidebarOrderStore((state) => state.projectOrder);
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    preferences.group === "status" ? state.collapsedWorkspaceGroupKeys : state.collapsedProjectKeys,
  );
  const resolvedProjectFilters = useMemo(
    () =>
      resolveActiveProjectFilters(
        preferences.projects,
        new Set(projects.map((project) => project.viewKey)),
      ),
    [preferences.projects, projects],
  );
  useEffect(() => {
    if (!pinsHydrated || !orderHydrated) return;
    for (const { source, agents } of roots) {
      const ready =
        source.supported &&
        source.hydrated &&
        agents.every(
          (agent) => snapshots.get(`${source.serverId}:${agent.id}`)?.status === "ready",
        );
      if (!ready) continue;
      const ordered = [...agents].sort(
        (a, b) =>
          oldPinnedOrder.indexOf(`${source.serverId}:${a.workspaceId}`) -
            oldPinnedOrder.indexOf(`${source.serverId}:${b.workspaceId}`) ||
          a.createdAt.getTime() - b.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      );
      migratePins(
        source.serverId,
        ordered.map((agent) => {
          const rank = oldPinnedOrder.indexOf(`${source.serverId}:${agent.workspaceId}`);
          return {
            key: `${source.serverId}:${agent.id}`,
            workspaceRank: rank < 0 ? Number.MAX_SAFE_INTEGER : rank,
            createdAt: agent.createdAt.getTime(),
          };
        }),
      );
    }
  }, [roots, snapshots, oldPinnedOrder, migratePins, pinsHydrated, orderHydrated]);
  const groups = useMemo(() => {
    const merged = new Map<string, { key: string; name: string; agents: Agent[] }>();
    for (const { source, agents } of roots) {
      for (const group of projectSessions({
        serverId: source.serverId,
        roots: agents,
        snapshots,
        projects,
        pinnedOrder,
        projectOrder,
        search,
        preferences: { ...preferences, projects: resolvedProjectFilters },
      })) {
        const existing = merged.get(group.key);
        if (existing) existing.agents.push(...group.agents);
        else merged.set(group.key, group);
      }
    }
    const order =
      preferences.group === "status"
        ? ["needs_input", "failed", "attention", "running", "done"]
        : projectOrder;
    return [...merged.values()]
      .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
      .map((group) => ({
        key: group.key,
        name: group.name,
        agents: sortSessionAgents({
          agents: group.agents,
          snapshots,
          pinnedOrder,
          sort: preferences.sort,
        }),
      }));
  }, [
    roots,
    snapshots,
    projects,
    pinnedOrder,
    projectOrder,
    preferences,
    search,
    resolvedProjectFilters,
  ]);
  const shortcutTargets = useMemo(
    () =>
      groups
        .filter((group) => !collapsed.has(group.key))
        .flatMap((group) =>
          group.agents.flatMap((agent) =>
            agent.workspaceId
              ? [{ serverId: agent.serverId, workspaceId: agent.workspaceId, agentId: agent.id }]
              : [],
          ),
        ),
    [groups, collapsed],
  );
  const shortcutIndexBySession = useMemo(
    () =>
      new Map(
        shortcutTargets
          .slice(0, 9)
          .map((target, index) => [`${target.serverId}:${target.agentId}`, index + 1]),
      ),
    [shortcutTargets],
  );
  const rowItems = useSidebarRowItems();
  const badges = useHostBadges({ enabled: rowItems.host && visibleHosts.length > 1 });
  return {
    groups,
    roots,
    snapshots,
    targets,
    visibleHosts,
    statuses,
    badges,
    rowItems,
    shortcutTargets,
    shortcutIndexBySession,
  };
}
