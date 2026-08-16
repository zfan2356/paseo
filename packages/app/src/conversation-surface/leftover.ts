export interface LinkedConversationTerminal {
  id: string;
  linkedAgentId: string;
}

export function findLinkedConversationTerminal(
  terminals: readonly { id: string; linkedAgentId?: string | null }[],
  agentId: string | null,
): LinkedConversationTerminal | null {
  if (!agentId) {
    return null;
  }
  for (const terminal of terminals) {
    if (terminal.linkedAgentId === agentId) {
      return { id: terminal.id, linkedAgentId: agentId };
    }
  }
  return null;
}

export function findTerminalTabId(
  tabs: readonly { tabId: string; target: { kind: string; terminalId?: string } }[],
  terminalId: string,
): string | null {
  for (const tab of tabs) {
    if (tab.target.kind === "terminal" && tab.target.terminalId === terminalId) {
      return tab.tabId;
    }
  }
  return null;
}

export function findFocusedLinkedConversationTerminal(
  terminals: readonly { id: string; linkedAgentId?: string | null }[],
  activeTarget: { kind: string; terminalId?: string } | null,
): LinkedConversationTerminal | null {
  if (activeTarget?.kind !== "terminal" || !activeTarget.terminalId) {
    return null;
  }
  const terminal = terminals.find((candidate) => candidate.id === activeTarget.terminalId);
  if (!terminal?.linkedAgentId) {
    return null;
  }
  return { id: terminal.id, linkedAgentId: terminal.linkedAgentId };
}

export function shouldAutoReleaseLeftoverTerminal(input: {
  focusedAgentId: string | null;
  leftoverTerminalId: string | null;
  focusedLinkedTerminalId: string | null;
}): boolean {
  return Boolean(
    input.focusedAgentId && input.leftoverTerminalId && !input.focusedLinkedTerminalId,
  );
}
