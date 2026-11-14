export interface FileExplorerWorkspaceScope {
  serverId?: string;
  sessionAgentId?: string | null;
  workspaceId?: string | null;
  workspaceRoot?: string | null;
}

export function normalizeWorkspaceValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildWorkspaceExplorerStateKey(scope: FileExplorerWorkspaceScope): string | null {
  if (scope.sessionAgentId && scope.workspaceRoot) {
    return `session-directory:${JSON.stringify([scope.serverId, scope.sessionAgentId, scope.workspaceRoot])}`;
  }
  const normalizedWorkspaceId = normalizeWorkspaceValue(scope.workspaceId);
  if (normalizedWorkspaceId) {
    return `workspace:${normalizedWorkspaceId}`;
  }
  const normalizedWorkspaceRoot = normalizeWorkspaceValue(scope.workspaceRoot);
  if (!normalizedWorkspaceRoot) {
    return null;
  }
  return `root:${normalizedWorkspaceRoot}`;
}
