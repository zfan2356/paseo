import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useHosts, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import type { AgentDirectoryEntry } from "@/types/agent-directory";
import { deriveRunningSubagentCounts, subagentActivityKey } from "./activity";
import { useProviderSubagentStore } from "./provider-store";

const SubagentActivity = createContext<ReadonlyMap<string, number>>(new Map());

export function SubagentActivityProvider({
  agents,
  children,
}: {
  agents: readonly AgentDirectoryEntry[];
  children: ReactNode;
}) {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connections = useHostRuntimeConnectionStatuses(serverIds);
  const providerSubagents = useProviderSubagentStore((state) => state.descriptors);
  const counts = useMemo(
    () =>
      deriveRunningSubagentCounts(
        agents.filter((agent) => connections.get(agent.serverId) === "online"),
        providerSubagents,
      ),
    [agents, connections, providerSubagents],
  );
  return <SubagentActivity.Provider value={counts}>{children}</SubagentActivity.Provider>;
}

export function useRunningSubagentCount(serverId: string, agentId: string | null): number {
  const counts = useContext(SubagentActivity);
  return agentId ? (counts.get(subagentActivityKey(serverId, agentId)) ?? 0) : 0;
}
