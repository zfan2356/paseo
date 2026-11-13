import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { createPaseoApi, type AgentChangeRequestsSnapshot } from "@getpaseo/client";
import { useSessionStore } from "@/stores/session-store";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { canObserveSessionGit, sidebarGitEntry, uniqueWorkspaceAgents } from "./session-git";

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
    useShallow((state) => serverIds.map((id) => state.sessions[id]?.agents)),
  );
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
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
  const subscriptions = useRef(
    new Map<
      string,
      { agentId: string; client: DaemonClient; stop: () => void; dispose: () => void }
    >(),
  );
  useEffect(() => {
    const runtime = getHostRuntimeStore();
    const desired = new Map(targets.map((target) => [target.workspaceKey, target]));
    for (const [key, subscription] of subscriptions.current) {
      const target = desired.get(key);
      const client = target && runtime.getClient(target.serverId);
      if (
        active &&
        source === "session" &&
        target &&
        target.agentId === subscription.agentId &&
        client === subscription.client &&
        statuses.get(target.serverId) === "online" &&
        client.supportsAgentChangeRequests()
      )
        continue;
      subscription.stop();
      subscription.dispose();
      subscriptions.current.delete(key);
      setSnapshots((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
    }
    if (!active || source !== "session") return;
    for (const target of targets) {
      const client = runtime.getClient(target.serverId);
      if (
        subscriptions.current.has(target.workspaceKey) ||
        !client ||
        !canObserveSessionGit(statuses.get(target.serverId) === "online", client)
      )
        continue;
      const api = createPaseoApi(client);
      let live = true;
      const stop = api.agents.ref(target.agentId).changeRequests.subscribe(
        (snapshot) => {
          if (live)
            setSnapshots((previous) => new Map(previous).set(target.workspaceKey, snapshot));
        },
        {
          onError: () => {
            if (live)
              setSnapshots((previous) => {
                const next = new Map(previous);
                next.delete(target.workspaceKey);
                return next;
              });
          },
        },
      );
      subscriptions.current.set(target.workspaceKey, {
        agentId: target.agentId,
        client,
        stop: () => {
          live = false;
          stop();
        },
        dispose: () => {
          void api.dispose();
        },
      });
    }
  }, [active, source, targets, statuses]);
  useEffect(
    () => () => {
      for (const subscription of subscriptions.current.values()) {
        subscription.stop();
        subscription.dispose();
      }
      subscriptions.current.clear();
    },
    [],
  );
  return useMemo(() => {
    if (source === "path") return entries;
    const agentsByWorkspace = new Map(
      targets.map((target) => [target.workspaceKey, target.agentId]),
    );
    return new Map(
      [...entries].map(([key, workspace]) => {
        const snapshot = snapshots.get(key);
        const agentId = agentsByWorkspace.get(key);
        return [
          key,
          sidebarGitEntry(
            workspace,
            source,
            active && statuses.get(workspace.serverId) === "online" && snapshot?.agentId === agentId
              ? snapshot
              : undefined,
          ),
        ];
      }),
    );
  }, [active, entries, source, snapshots, targets, statuses]);
}
