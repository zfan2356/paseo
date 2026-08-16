import type { ConversationSessionRef } from "./session";

export type ConversationSurface = "agent" | "tui";

export type ConversationViewSwitchPlan =
  | {
      action: "toggle-surface";
      session: ConversationSessionRef;
      nextSurface: ConversationSurface;
    }
  | {
      action: "release-then-toggle";
      session: ConversationSessionRef;
      terminalId: string;
      nextSurface: ConversationSurface;
    }
  | { action: "leave-linked-terminal"; terminalId: string }
  | { action: "none" };

export function toggleConversationSurface(surface: ConversationSurface): ConversationSurface {
  return surface === "agent" ? "tui" : "agent";
}

export function planConversationViewSwitch(input: {
  session: ConversationSessionRef | null;
  surface: ConversationSurface;
  leftoverTerminalId: string | null;
  leftoverVisibleInAnyPane: boolean;
  focusedLinkedTerminalId: string | null;
  canReleaseLeftover: boolean;
}): ConversationViewSwitchPlan {
  if (
    input.session &&
    input.leftoverTerminalId &&
    input.canReleaseLeftover &&
    !input.leftoverVisibleInAnyPane
  ) {
    return {
      action: "release-then-toggle",
      session: input.session,
      terminalId: input.leftoverTerminalId,
      nextSurface: toggleConversationSurface(input.surface),
    };
  }
  if (input.session) {
    return {
      action: "toggle-surface",
      session: input.session,
      nextSurface: toggleConversationSurface(input.surface),
    };
  }
  if (input.focusedLinkedTerminalId) {
    return { action: "leave-linked-terminal", terminalId: input.focusedLinkedTerminalId };
  }
  return { action: "none" };
}
