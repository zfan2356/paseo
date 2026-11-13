import type { SessionContext } from "@getpaseo/protocol/session-context";
import { isWorkspaceRootAgent } from "@/subagents/policies";

interface SessionIdentity {
  id: string;
  workspaceId?: string;
  parentAgentId: string | null;
  archivedAt?: Date | null;
  background?: boolean;
}
export function visibleSessionAgents<T extends SessionIdentity>(
  agents: ReadonlyMap<string, T>,
): T[] {
  return [...agents.values()].filter((agent) => {
    const parent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    return !agent.archivedAt && !agent.background && isWorkspaceRootAgent(agent, parent);
  });
}
export interface SessionDirectory {
  path: string;
  launch: boolean;
}
export function sessionDirectories(context: SessionContext | null): SessionDirectory[] {
  if (!context) return [];
  return [
    { path: context.launchDirectory, launch: true },
    ...context.linkedDirectories.map(({ path }) => ({ path, launch: false })),
  ];
}
export interface RepositoryDirectory extends SessionDirectory {
  repository: string | null;
}
interface DirectoryGroup<T> {
  repository: string | null;
  directories: T[];
}
export function groupDirectories<T extends RepositoryDirectory>(
  directories: readonly T[],
): DirectoryGroup<T>[] {
  const groups = new Map<string | null, DirectoryGroup<T>>();
  for (const directory of directories) {
    let group = groups.get(directory.repository);
    if (!group) {
      group = { repository: directory.repository, directories: [] };
      groups.set(directory.repository, group);
    }
    group.directories.push(directory);
  }
  return [...groups.values()];
}

export function movePinnedSession(
  order: readonly string[],
  sessionKey: string,
  neighborKey: string,
): string[] {
  const next = [...order];
  if (!next.includes(sessionKey)) next.push(sessionKey);
  if (!next.includes(neighborKey)) next.push(neighborKey);
  const from = next.indexOf(sessionKey);
  const to = next.indexOf(neighborKey);
  next[from] = neighborKey;
  next[to] = sessionKey;
  return next;
}
