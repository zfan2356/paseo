export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";
// Keep the legacy key so active Codex terminal leases survive fork upgrades.
export const AGENT_TERMINAL_OWNER_LABEL = "paseo.codex-terminal-owner";
export const CODEX_TERMINAL_OWNER_LABEL = AGENT_TERMINAL_OWNER_LABEL;
const OPEN_AGENT_TAB_LABEL_PREFIX = "paseo.open-agent-tab.";

export function getOpenAgentTabLabel(clientId: string): string {
  return `${OPEN_AGENT_TAB_LABEL_PREFIX}${clientId}`;
}

export function isOpenAgentTabLabel(label: string): boolean {
  return label.startsWith(OPEN_AGENT_TAB_LABEL_PREFIX);
}

export interface AgentLabelSource {
  labels?: Record<string, unknown> | null;
}

export function getParentAgentIdFromLabels(labels: Record<string, unknown> | null | undefined) {
  const parentAgentId = labels?.[PARENT_AGENT_ID_LABEL];
  return typeof parentAgentId === "string" && parentAgentId.trim().length > 0
    ? parentAgentId.trim()
    : null;
}

export function getAgentTerminalOwnerId(
  labels: Record<string, unknown> | null | undefined,
): string | null {
  const terminalId = labels?.[AGENT_TERMINAL_OWNER_LABEL];
  return typeof terminalId === "string" && terminalId.trim().length > 0 ? terminalId.trim() : null;
}

export const getCodexTerminalOwnerId = getAgentTerminalOwnerId;

export function isDelegatedAgent(agent: AgentLabelSource): boolean {
  return getParentAgentIdFromLabels(agent.labels) !== null;
}

export function hasOpenAgentTab(labels: Record<string, unknown> | null | undefined): boolean {
  return Object.entries(labels ?? {}).some(
    ([label, value]) => isOpenAgentTabLabel(label) && value === "true",
  );
}
