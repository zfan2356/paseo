export interface ConversationTerminalSwitchResult {
  success: boolean;
  agentId?: string | null;
  error?: string | null;
}

export interface ConversationTerminalReleaseClient {
  switchAgentTerminalToAgent?: (terminalId: string) => Promise<ConversationTerminalSwitchResult>;
  switchCodexTerminalToAgent?: (terminalId: string) => Promise<ConversationTerminalSwitchResult>;
  killTerminal: (terminalId: string) => Promise<{ success?: boolean }>;
}

export async function releaseConversationTerminalOwner(input: {
  terminalId: string;
  agentId: string;
  client: ConversationTerminalReleaseClient;
  canSwitchToAgent: boolean;
  canSwitchLegacyCodex: boolean;
  fetchTimeline: (agentId: string) => Promise<void>;
  failedMessage: string;
}): Promise<string> {
  const switchToAgent = resolveConversationTerminalSwitch(input);
  if (switchToAgent) {
    try {
      const result = await switchToAgent(input.terminalId);
      if (result.success && result.agentId) {
        await input.fetchTimeline(result.agentId);
        return result.agentId;
      }
    } catch {
      // A leftover lease must not stay stuck because hydrate failed.
    }
  }

  return killLeftoverConversationTerminal(input);
}

function resolveConversationTerminalSwitch(input: {
  client: ConversationTerminalReleaseClient;
  canSwitchToAgent: boolean;
  canSwitchLegacyCodex: boolean;
}): ((terminalId: string) => Promise<ConversationTerminalSwitchResult>) | undefined {
  if (input.canSwitchToAgent) {
    return input.client.switchAgentTerminalToAgent;
  }
  if (input.canSwitchLegacyCodex) {
    return input.client.switchCodexTerminalToAgent;
  }
  return undefined;
}

async function killLeftoverConversationTerminal(input: {
  terminalId: string;
  agentId: string;
  client: ConversationTerminalReleaseClient;
  fetchTimeline: (agentId: string) => Promise<void>;
  failedMessage: string;
}): Promise<string> {
  const killed = await input.client.killTerminal(input.terminalId);
  if (killed.success === false) {
    throw new Error(input.failedMessage);
  }
  await input.fetchTimeline(input.agentId);
  return input.agentId;
}
