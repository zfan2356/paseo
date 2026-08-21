export interface SideChatAgent {
  archivedAt?: string | number | Date | null;
  provider?: string | null;
}

// Side questions ride the Claude Code SDK "side_question" control request, so
// the entry point only appears for live Claude agents on hosts that advertise
// the capability.
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
  return agent.provider === "claude";
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
