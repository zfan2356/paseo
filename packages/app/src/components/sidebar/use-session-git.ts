import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { createPaseoApi, type AgentChangeRequestsSnapshot } from "@getpaseo/client";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { createSessionGitObserver } from "./session-git-observer";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import {
  canObserveSessionGit,
  projectSidebarSessionGit,
  uniqueWorkspaceAgents,
  type SidebarGitProjectionItem,
} from "./session-git";

export function useSidebarSessionGit(
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>,
  source: "session" | "path",
  active: boolean,
): ReadonlyMap<string, SidebarWorkspaceEntry> {
  const serverIdKey = JSON.stringify(
    [...new Set([...entries.values()].map((entry) => entry.serverId))].sort(),
  );
  const serverIds = useMemo<string[]>(() => JSON.parse(serverIdKey), [serverIdKey]);
  const sessions = useSessionStore(
    useShallow((state) =>
      serverIds.map((id) =>
        state.sessions[id]?.hasHydratedAgents ? state.sessions[id]?.agents : undefined,
      ),
    ),
  );
  const runtime = getHostRuntimeStore();
  const readinessKey = useSyncExternalStore(
    (listener) => runtime.subscribeAll(listener),
    () =>
      JSON.stringify(
        serverIds.map((id) => {
          const snapshot = runtime.getSnapshot(id);
          return (
            snapshot?.connectionStatus === "online" &&
            snapshot.agentDirectoryStatus === "ready" &&
            snapshot.client?.supportsAgentChangeRequests() === true
          );
        }),
      ),
    () => "[]",
  );
  const readiness = useMemo<boolean[]>(() => JSON.parse(readinessKey), [readinessKey]);
  const readyHosts = useMemo(
    () => new Set(serverIds.filter((_, i) => readiness[i])),
    [serverIds, readiness],
  );
  const targetKey = useMemo(() => {
    const ids = new Map<string, string>();
    for (let i = 0; i < serverIds.length; i++) {
      const agents = sessions[i];
      if (!agents) continue;
      for (const [workspaceId, agentId] of uniqueWorkspaceAgents(agents))
        ids.set(`${serverIds[i]}:${workspaceId}`, agentId);
    }
    return JSON.stringify(
      [...entries.values()]
        .flatMap((entry) => {
          const agentId = ids.get(
            `${entry.serverId}:${normalizeWorkspaceOpaqueId(entry.workspaceId)}`,
          );
          return agentId
            ? [{ workspaceKey: entry.workspaceKey, serverId: entry.serverId, agentId }]
            : [];
        })
        .sort((a, b) => a.workspaceKey.localeCompare(b.workspaceKey)),
    );
  }, [entries, serverIds, sessions]);
  const targets = useMemo<{ workspaceKey: string; serverId: string; agentId: string }[]>(
    () => JSON.parse(targetKey),
    [targetKey],
  );
  const [snapshots, setSnapshots] = useState<Map<string, AgentChangeRequestsSnapshot>>(new Map());
  const observer = useRef<ReturnType<typeof createSessionGitObserver> | null>(null);
  useEffect(() => {
    const current = createSessionGitObserver(
      {
        observe(target, update, error) {
          const client = runtime.getClient(target.serverId);
          if (!client || !canObserveSessionGit(true, client)) {
            error();
            return () => {};
          }
          const api = createPaseoApi(client);
          const stop = api.agents
            .ref(target.agentId)
            .changeRequests.subscribe(update, { onError: error });
          return () => {
            stop();
            void api
              .dispose()
              .catch((cause) => console.error("Change request API cleanup failed", cause));
          };
        },
        schedule(callback) {
          const timer = setTimeout(callback, 1000);
          return () => clearTimeout(timer);
        },
      },
      (key, snapshot) =>
        setSnapshots((previous) => {
          const next = new Map(previous);
          if (snapshot) next.set(key, snapshot);
          else next.delete(key);
          return next;
        }),
    );
    observer.current = current;
    return () => {
      current.close();
      observer.current = null;
    };
  }, [runtime]);
  useEffect(() => {
    observer.current?.setTargets(
      active && source === "session"
        ? targets.filter((target) => readyHosts.has(target.serverId))
        : [],
    );
  }, [active, source, targets, readyHosts]);
  const previousProjection = useRef(new Map<string, SidebarGitProjectionItem>());
  return useMemo(() => {
    if (source === "path") {
      previousProjection.current.clear();
      return entries;
    }
    const agentsByWorkspace = new Map(
      targets.map((target) => [target.workspaceKey, target.agentId]),
    );
    const projection = projectSidebarSessionGit(
      entries,
      snapshots,
      agentsByWorkspace,
      (serverId) => active && readyHosts.has(serverId),
      previousProjection.current,
    );
    previousProjection.current = projection;
    return new Map([...projection].map(([key, value]) => [key, value.projected]));
  }, [active, entries, source, snapshots, targets, readyHosts]);
}
