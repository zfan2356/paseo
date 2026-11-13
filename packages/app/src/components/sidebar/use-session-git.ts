import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { createPaseoApi, type AgentChangeRequestsSnapshot } from "@getpaseo/client";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  createSessionGitObserver,
  validateSessionDirectories,
  sessionGitConnection,
  eligibleSessionGitTargets,
} from "./session-git-observer";
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
  const connectionKey = useSyncExternalStore(
    (listener) => runtime.subscribeAll(listener),
    () =>
      JSON.stringify(
        serverIds.map((id) => {
          return sessionGitConnection(runtime.getSnapshot(id));
        }),
      ),
    () => "[]",
  );
  const connections = useMemo<(string | null)[]>(() => JSON.parse(connectionKey), [connectionKey]);
  const validationRun = useMemo(
    () => ({ active, source, serverIds, connections }),
    [active, source, serverIds, connections],
  );
  const [verified, setVerified] = useState<{ run: object; epochs: Map<string, string> } | null>(
    null,
  );
  useEffect(() => {
    if (!active || source !== "session") return;
    const pending = new Map<string, string>();
    serverIds.forEach((id, index) => {
      const epoch = connections[index];
      if (epoch) pending.set(id, epoch);
    });
    return validateSessionDirectories(
      pending,
      {
        async refresh(serverId, epoch) {
          await runtime.refreshDirectories(serverId);
          const snapshot = runtime.getSnapshot(serverId);
          const current = snapshot && `${snapshot.clientGeneration}:${snapshot.connectionEpoch}`;
          return (
            snapshot?.connectionStatus === "online" &&
            snapshot.agentDirectoryStatus === "ready" &&
            current === epoch
          );
        },
        schedule(callback, delay) {
          const timer = setTimeout(callback, delay);
          return () => clearTimeout(timer);
        },
      },
      (completed) =>
        setVerified((previous) => {
          const epochs = new Map(previous?.run === validationRun ? previous.epochs : []);
          for (const [serverId, epoch] of completed) epochs.set(serverId, epoch);
          return { run: validationRun, epochs };
        }),
    );
  }, [active, source, serverIds, connections, runtime, validationRun]);
  const readyHosts = useMemo(
    () =>
      new Set(
        serverIds.filter(
          (id, index) =>
            connections[index] &&
            verified?.run === validationRun &&
            verified.epochs.get(id) === connections[index],
        ),
      ),
    [serverIds, connections, verified, validationRun],
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
        schedule(callback, delay) {
          const timer = setTimeout(callback, delay);
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
    observer.current?.setTargets(eligibleSessionGitTargets(targets, active, source, readyHosts));
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
