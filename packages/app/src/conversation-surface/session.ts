import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

export interface ConversationSessionRef {
  agentId: string;
}

export const CONVERSATION_SURFACE_PROVIDERS = new Set(["codex", "claude", "cursor"]);

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

export function canOfferConversationSurfaceSwitch(
  agent: {
    provider?: string | null;
    persistence?: { sessionId?: string | null } | null;
    archivedAt?: string | number | Date | null;
  } | null,
): boolean {
  if (!agent?.provider || agent.archivedAt) {
    return false;
  }
  return (
    CONVERSATION_SURFACE_PROVIDERS.has(agent.provider) && Boolean(agent.persistence?.sessionId)
  );
}
