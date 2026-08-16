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

export function collectLinkedAgentIds(
  terminals: readonly { linkedAgentId?: string | null }[],
): string[] {
  const agentIds = new Set<string>();
  for (const terminal of terminals) {
    if (terminal.linkedAgentId) {
      agentIds.add(terminal.linkedAgentId);
    }
  }
  return [...agentIds];
}

export function collectLeaseBlockedAgentIds(
  terminals: readonly { linkedAgentId?: string | null }[],
  pendingAgentId: string | null,
): string[] {
  const agentIds = collectLinkedAgentIds(terminals);
  if (pendingAgentId && !agentIds.includes(pendingAgentId)) {
    agentIds.push(pendingAgentId);
  }
  return agentIds;
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

export function collectPaneFocusedTargets(
  panes: readonly { focusedTabId: string | null }[],
  tabs: readonly { tabId: string; target: { kind: string; terminalId?: string } }[],
): { kind: string; terminalId?: string }[] {
  const targetByTabId = new Map(tabs.map((tab) => [tab.tabId, tab.target]));
  const targets: { kind: string; terminalId?: string }[] = [];
  for (const pane of panes) {
    if (!pane.focusedTabId) {
      continue;
    }
    const target = targetByTabId.get(pane.focusedTabId);
    if (target) {
      targets.push(target);
    }
  }
  return targets;
}

export function isLeftoverVisibleInAnyPane(
  leftoverTerminalId: string | null,
  paneFocusedTargets: readonly { kind: string; terminalId?: string }[],
): boolean {
  if (!leftoverTerminalId) {
    return false;
  }
  return paneFocusedTargets.some(
    (target) => target.kind === "terminal" && target.terminalId === leftoverTerminalId,
  );
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
  leftoverVisibleInAnyPane: boolean;
}): boolean {
  return Boolean(
    input.focusedAgentId && input.leftoverTerminalId && !input.leftoverVisibleInAnyPane,
  );
}
