import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface ConversationSessionRef {
  agentId: string;
}

export interface ConversationSurfaceAgent {
  archivedAt?: string | number | Date | null;
  provider?: string | null;
  persistence?: { sessionId?: string | null } | null;
}

export function conversationSessionRefFromAgentId(
  agentId: string | null | undefined,
): ConversationSessionRef | null {
  if (typeof agentId !== "string") {
    return null;
  }
  const trimmed = agentId.trim();
  return trimmed.length > 0 ? { agentId: trimmed } : null;
}

export function conversationSessionRefFromTabTarget(
  target: WorkspaceTabTarget | null | undefined,
): ConversationSessionRef | null {
  if (target?.kind !== "agent") {
    return null;
  }
  return conversationSessionRefFromAgentId(target.agentId);
}

export function isConversationTerminalProvider(provider: string | null | undefined): boolean {
  return provider === "codex" || provider === "claude" || provider === "cursor";
}

export function canOfferConversationSurfaceSwitch(
  agent: ConversationSurfaceAgent | null,
  options: {
    supported: boolean;
    supportsLegacyCodex: boolean;
  },
): boolean {
  if (!agent || agent.archivedAt) {
    return false;
  }
  if (!isConversationTerminalProvider(agent.provider)) {
    return false;
  }
  if (!agent.persistence?.sessionId) {
    return false;
  }
  if (options.supported) {
    return true;
  }
  return options.supportsLegacyCodex && agent.provider === "codex";
}
