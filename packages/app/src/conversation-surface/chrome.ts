import type { ConversationSurface } from "./switch";

export type ConversationViewSwitchLabelKey =
  | "workspace.header.actions.switchToConversationTerminal"
  | "workspace.header.actions.switchToAgentView";

export interface ConversationViewSwitchChrome {
  show: boolean;
  labelKey: ConversationViewSwitchLabelKey;
  disabled: boolean;
}

export function resolveConversationViewSwitchChrome(input: {
  agentId: string | null;
  surface: ConversationSurface;
  hasLinkedTerminal: boolean;
  isLeavingLinkedTerminal: boolean;
  isConnected: boolean;
  hasWorkspaceDirectory: boolean;
}): ConversationViewSwitchChrome {
  const show = Boolean(input.agentId || input.hasLinkedTerminal);
  const labelKey: ConversationViewSwitchLabelKey =
    input.agentId && input.surface === "agent"
      ? "workspace.header.actions.switchToConversationTerminal"
      : "workspace.header.actions.switchToAgentView";
  const disabled =
    input.isLeavingLinkedTerminal ||
    (input.hasLinkedTerminal && (!input.isConnected || !input.hasWorkspaceDirectory));
  return { show, labelKey, disabled };
}
