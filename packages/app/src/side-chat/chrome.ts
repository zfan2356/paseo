export interface SideChatAgent {
  archivedAt?: string | number | Date | null;
  provider?: string | null;
}

// Side chats are ephemeral forks of the provider conversation, so the entry
// point only appears for live agents whose providers support native forking.
export function canOfferSideChat(
  agent: SideChatAgent | null,
  options: { featureEnabled: boolean },
): boolean {
  if (!options.featureEnabled) {
    return false;
  }
  if (!agent || agent.archivedAt) {
    return false;
  }
  return agent.provider === "claude" || agent.provider === "codex";
}

export interface SideChatHeaderChrome {
  show: boolean;
  disabled: boolean;
}

export function resolveSideChatHeaderChrome(input: {
  canOffer: boolean;
  isConnected: boolean;
}): SideChatHeaderChrome {
  return {
    show: input.canOffer,
    disabled: !input.isConnected,
  };
}
