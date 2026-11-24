import type { AgentCapabilityFlags } from "@getpaseo/protocol/agent-types";

export interface SideChatAgent {
  archivedAt?: string | number | Date | null;
  provider?: string | null;
  capabilities?: AgentCapabilityFlags | null;
}

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
  return agent.capabilities?.sideChatFork === true;
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
