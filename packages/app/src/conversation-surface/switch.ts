import type { ConversationSessionRef } from "./session";

export type ConversationSurface = "agent" | "tui";

export type ConversationViewSwitchPlan =
  | {
      action: "toggle-surface";
      session: ConversationSessionRef;
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
  linkedTerminalId: string | null;
}): ConversationViewSwitchPlan {
  if (input.session) {
    return {
      action: "toggle-surface",
      session: input.session,
      nextSurface: toggleConversationSurface(input.surface),
    };
  }
  if (input.linkedTerminalId) {
    return { action: "leave-linked-terminal", terminalId: input.linkedTerminalId };
  }
  return { action: "none" };
}
