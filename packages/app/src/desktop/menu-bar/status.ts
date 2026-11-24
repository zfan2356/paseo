import type { AgentDirectoryEntry } from "@/types/agent-directory";
import type { HostRuntimeSnapshot } from "@/runtime/host-runtime";
import type { MenuBarSnapshot, MenuBarTask } from "../../../../desktop/src/features/menu-bar/state";

export type MenuBarAgent = Pick<
  AgentDirectoryEntry,
  | "id"
  | "serverId"
  | "title"
  | "status"
  | "turn"
  | "pendingPermissionCount"
  | "archivedAt"
  | "requiresAttention"
  | "attentionReason"
  | "lastError"
  | "cwd"
  | "provider"
  | "lastActivityAt"
>;
export type MenuBarHost = Pick<
  HostRuntimeSnapshot,
  "serverId" | "connectionStatus" | "agentDirectoryStatus"
> & { label: string };

function taskStatus(agent: MenuBarAgent): MenuBarTask["status"] | null {
  if ((agent.pendingPermissionCount ?? 0) > 0 || agent.attentionReason === "permission")
    return "waiting";
  if (agent.status === "error" || agent.attentionReason === "error") return "failed";
  if (agent.turn.phase === "open" || agent.status === "running" || agent.status === "initializing")
    return "running";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "finished";
  return null;
}

const priority = { waiting: 0, failed: 1, running: 2, finished: 3 };

export function deriveMenuBarSnapshot(
  agents: readonly MenuBarAgent[],
  hosts: readonly MenuBarHost[],
): MenuBarSnapshot {
  const snapshot: MenuBarSnapshot = {
    hosts: hosts.map((host) => {
      let status: MenuBarSnapshot["hosts"][number]["status"] = "offline";
      if (host.connectionStatus === "online") {
        status = host.agentDirectoryStatus === "ready" ? "ready" : "syncing";
      } else if (host.connectionStatus === "connecting") {
        status = "syncing";
      }
      return { serverId: host.serverId, label: host.label.slice(0, 200), status };
    }),
    running: 0,
    waiting: 0,
    failed: 0,
    finished: 0,
    tasks: [],
  };
  const ready = new Set(
    snapshot.hosts.filter((host) => host.status === "ready").map((host) => host.serverId),
  );
  const seen = new Set<string>();
  for (const agent of agents) {
    if (agent.archivedAt || !ready.has(agent.serverId)) continue;
    const key = JSON.stringify([agent.serverId, agent.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const status = taskStatus(agent);
    if (!status) continue;
    snapshot[status]++;
    snapshot.tasks.push({
      serverId: agent.serverId,
      agentId: agent.id,
      title: (agent.title?.trim() || "Untitled task").slice(0, 200),
      status,
      summary: (status === "failed" && agent.lastError
        ? agent.lastError
        : `${agent.provider} · ${
            agent.cwd
              .replace(/[\\/]+$/, "")
              .split(/[\\/]/)
              .pop() || agent.cwd
          }`
      )
        .replace(/\s+/g, " ")
        .slice(0, 300),
      updatedAt: agent.lastActivityAt.getTime(),
    });
  }
  snapshot.tasks.sort((left, right) => priority[left.status] - priority[right.status]);
  // Reserve room for every group; a busy running list must not hide errors or completions.
  const kept = { waiting: 0, failed: 0, running: 0, finished: 0 };
  snapshot.tasks = snapshot.tasks.filter((task) => ++kept[task.status] <= 12);
  return snapshot;
}
