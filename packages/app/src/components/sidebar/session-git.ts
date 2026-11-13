import type { AgentChangeRequestsSnapshot } from "@getpaseo/client";
import type { Agent } from "@/stores/session-store";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { normalizeWorkspaceOpaqueId } from "@/utils/workspace-identity";
import { normalizeForge } from "@/git/forge";
import { selectPrHintFromStatus, type PrHint } from "@/git/pr-hint";

export function uniqueWorkspaceAgents(agents: ReadonlyMap<string, Agent>): Map<string, string> {
  const result = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      agent.background ||
      !agent.workspaceId ||
      !isWorkspaceRootAgent(
        agent,
        agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined,
      )
    )
      continue;
    const workspaceId = normalizeWorkspaceOpaqueId(agent.workspaceId);
    if (!workspaceId) continue;
    if (result.has(workspaceId)) {
      result.delete(workspaceId);
      ambiguous.add(workspaceId);
    } else if (!ambiguous.has(workspaceId)) result.set(workspaceId, agent.id);
  }
  return result;
}

export function sessionPrHint(snapshot: AgentChangeRequestsSnapshot | undefined): PrHint | null {
  if (!snapshot?.items.length) return null;
  const items = [...snapshot.items].sort((a, b) => {
    const closed = (item: typeof a) =>
      item.status?.isMerged || item.status?.state === "merged" || item.status?.state === "closed";
    const rank = Number(Boolean(closed(a))) - Number(Boolean(closed(b)));
    return (
      rank ||
      b.reference.addedAt.localeCompare(a.reference.addedAt) ||
      a.reference.key.localeCompare(b.reference.key)
    );
  });
  const item = items[0];
  const hint = selectPrHintFromStatus(item.status, item.reference.forge) ?? {
    url: item.reference.url,
    number: item.reference.number,
    state: "unknown" as const,
    forge: normalizeForge(item.reference.forge),
  };
  return { ...hint, additionalCount: items.length - 1 };
}

export function sidebarGitEntry(
  workspace: SidebarWorkspaceEntry,
  source: "session" | "path",
  snapshot: AgentChangeRequestsSnapshot | undefined,
): SidebarWorkspaceEntry {
  if (source === "path") return workspace;
  return { ...workspace, prHint: sessionPrHint(snapshot), diffStat: null };
}

export function canObserveSessionGit(
  connected: boolean,
  client: { supportsAgentChangeRequests(): boolean } | null,
): boolean {
  return connected && client !== null && client.supportsAgentChangeRequests();
}
