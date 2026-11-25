import { getParentAddressFromLabels } from "@getpaseo/protocol/agent-labels";
import { runningBackgroundWorkCount } from "@getpaseo/protocol/agent-state-bucket";
import type { ProviderSubagentDescriptorPayload } from "@getpaseo/protocol/messages";
import type { AgentDirectoryEntry } from "@/types/agent-directory";

type ActivityAgent = Pick<
  AgentDirectoryEntry,
  | "id"
  | "serverId"
  | "labels"
  | "archivedAt"
  | "status"
  | "turn"
  | "pendingPermissionCount"
  | "attentionReason"
  | "backgroundWork"
>;

export type ProviderSubagentActivity = ReadonlyMap<
  string,
  Pick<ProviderSubagentDescriptorPayload, "parentAgentId" | "status">
>;

export function subagentActivityKey(serverId: string, agentId: string): string {
  return `${serverId}\0${agentId}`;
}

function isWorking(agent: ActivityAgent): boolean {
  if (
    (agent.pendingPermissionCount ?? 0) > 0 ||
    agent.attentionReason === "permission" ||
    agent.attentionReason === "error" ||
    agent.status === "error"
  ) {
    return false;
  }
  return (
    agent.turn.phase === "open" ||
    agent.status === "running" ||
    agent.status === "initializing" ||
    runningBackgroundWorkCount(agent.backgroundWork) > 0
  );
}

export function deriveRunningSubagentCounts(
  agents: readonly ActivityAgent[],
  providerSubagents?: ProviderSubagentActivity,
): ReadonlyMap<string, number> {
  const sessions = new Map<string, { parent: string | null; running: boolean }>();
  for (const agent of agents) {
    const key = subagentActivityKey(agent.serverId, agent.id);
    if (agent.archivedAt || sessions.has(key)) continue;
    const parent = getParentAddressFromLabels(agent.labels, agent.serverId);
    sessions.set(key, {
      parent: parent && subagentActivityKey(parent.serverId, parent.agentId),
      running: isWorking(agent),
    });
  }

  const counts = new Map<string, number>();
  // Stop at an unknown or archived parent. A cached child should never create a task for it.
  function countForAncestors(ancestor: string | null, visited: Set<string>) {
    let key = ancestor;
    while (key && !visited.has(key)) {
      const session = sessions.get(key);
      if (!session) break;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      visited.add(key);
      key = session.parent;
    }
  }

  for (const [key, session] of sessions) {
    if (session.running && session.parent) countForAncestors(session.parent, new Set([key]));
  }
  for (const [key, child] of providerSubagents ?? []) {
    if (child.status !== "running") continue;
    // The provider store keys a child by host, owning Paseo session and provider subagent ID.
    const serverId = key.split("\0", 1)[0];
    countForAncestors(subagentActivityKey(serverId, child.parentAgentId), new Set());
  }
  return counts;
}
