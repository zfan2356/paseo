import type { ConversationSurface } from "./switch";

export type ConversationViewSwitchLabelKey =
  | "workspace.header.actions.switchToTuiView"
  | "workspace.header.actions.switchToAgentView";

export interface ConversationViewSwitchChrome {
  show: boolean;
  labelKey: ConversationViewSwitchLabelKey;
  disabled: boolean;
}

export function resolveConversationViewSwitchChrome(input: {
  agentId: string | null;
  surface: ConversationSurface;
  isFocusedOnLinkedTerminal: boolean;
  isPending: boolean;
  isConnected: boolean;
  hasWorkspaceDirectory: boolean;
}): ConversationViewSwitchChrome {
  const show = Boolean(input.agentId || input.isFocusedOnLinkedTerminal);
  const labelKey: ConversationViewSwitchLabelKey =
    input.agentId && input.surface === "agent"
      ? "workspace.header.actions.switchToTuiView"
      : "workspace.header.actions.switchToAgentView";
  const needsHost = input.isFocusedOnLinkedTerminal;
  const disabled =
    needsHost && (input.isPending || !input.isConnected || !input.hasWorkspaceDirectory);
  return { show, labelKey, disabled };
}
