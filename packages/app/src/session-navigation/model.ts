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

export function contextSnapshotForHost<T>(input: {
  supported: boolean;
  snapshot: T | undefined;
}): T | undefined {
  return input.supported ? input.snapshot : undefined;
}
interface DirectoryFactsPort<T> {
  listDirectory(cwd: string, path: string): Promise<unknown>;
  checkoutRefresh(cwd: string): Promise<{ success: boolean; error: { message: string } | null }>;
  getCheckoutStatus(cwd: string): Promise<T>;
}
export async function readDirectoryFacts<T>(input: {
  client: DirectoryFactsPort<T>;
  path: string;
  refreshError: string;
}): Promise<T> {
  await input.client.listDirectory(input.path, input.path);
  const refresh = await input.client.checkoutRefresh(input.path);
  if (!refresh.success) throw new Error(refresh.error?.message ?? input.refreshError);
  return input.client.getCheckoutStatus(input.path);
}
export function openChangesPullRequest(input: {
  directory?: string;
  url: string;
  openExternal(url: string): void;
  openWorkspace(): void;
}): void {
  if (input.directory) input.openExternal(input.url);
  else input.openWorkspace();
}
export interface LegacySessionPin {
  key: string;
  workspaceRank: number;
  createdAt: number;
}
export function mergeLegacySessionPins(input: {
  order: readonly string[];
  ranks: Record<string, Omit<LegacySessionPin, "key">>;
  entries: LegacySessionPin[];
  edited: boolean;
}) {
  const ranks = { ...input.ranks };
  const order = [...input.order];
  for (const { key, workspaceRank, createdAt } of input.entries) {
    ranks[key] = { workspaceRank, createdAt };
    if (!order.includes(key)) order.push(key);
  }
  if (!input.edited)
    order.sort((a, b) => {
      const left = ranks[a];
      const right = ranks[b];
      if (!left || !right) return 0;
      return (
        left.workspaceRank - right.workspaceRank ||
        left.createdAt - right.createdAt ||
        a.localeCompare(b)
      );
    });
  return { order, ranks };
}

type CheckoutRootStatus =
  | Pick<
      Extract<
        import("@getpaseo/protocol/messages").CheckoutStatusResponse["payload"],
        { isGit: true }
      >,
      "isGit" | "repoRoot"
    >
  | Pick<
      Extract<
        import("@getpaseo/protocol/messages").CheckoutStatusResponse["payload"],
        { isGit: false }
      >,
      "isGit" | "repoRoot"
    >;
export function checkoutDirectory(input: {
  directory: string;
  status: CheckoutRootStatus | null;
}): string {
  return input.status?.isGit ? input.status.repoRoot : input.directory;
}

export function executionDirectoryLabel(directory: string, paths: readonly string[]): string {
  const segments = directory.split(/[\\/]/).filter(Boolean);
  const others = paths.filter((candidate) => candidate !== directory);
  for (let depth = 1; depth <= segments.length; depth++) {
    const suffix = segments.slice(-depth).join("/");
    const conflicts = others.some(
      (candidate) => candidate.split(/[\\/]/).filter(Boolean).slice(-depth).join("/") === suffix,
    );
    if (!conflicts) return /^[A-Za-z]:/.test(suffix) ? directory : suffix;
  }
  return directory;
}
