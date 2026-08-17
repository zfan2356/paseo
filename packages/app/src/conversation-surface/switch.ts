import type { ConversationSessionRef } from "./session";

export type ConversationSurface = "agent" | "tui";

export type ConversationViewSwitchPlan =
  | {
      action: "open-terminal";
      session: ConversationSessionRef;
      terminalId: string | null;
    }
  | { action: "leave-linked-terminal"; terminalId: string }
  | { action: "none" };

export function planConversationViewSwitch(input: {
  session: ConversationSessionRef | null;
  leftoverTerminalId: string | null;
  focusedLinkedTerminalId: string | null;
  canOpenTerminal: boolean;
}): ConversationViewSwitchPlan {
  if (input.session && (input.leftoverTerminalId || input.canOpenTerminal)) {
    return {
      action: "open-terminal",
      session: input.session,
      terminalId: input.leftoverTerminalId,
    };
  }
  if (input.focusedLinkedTerminalId) {
    return { action: "leave-linked-terminal", terminalId: input.focusedLinkedTerminalId };
  }
  return { action: "none" };
}
