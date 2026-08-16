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
  let switchToAgent = input.client.switchAgentTerminalToAgent;
  if (!input.canSwitchToAgent) {
    switchToAgent = input.canSwitchLegacyCodex
      ? input.client.switchCodexTerminalToAgent
      : undefined;
  }

  if (switchToAgent) {
    const result = await switchToAgent(input.terminalId);
    if (!result.success || !result.agentId) {
      throw new Error(result.error ?? input.failedMessage);
    }
    await input.fetchTimeline(result.agentId);
    return result.agentId;
  }

  await input.client.killTerminal(input.terminalId);
  await input.fetchTimeline(input.agentId);
  return input.agentId;
}
