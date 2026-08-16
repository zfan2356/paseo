import type { ConversationSurface } from "./switch";

export interface ConversationSurfaceAppearance {
  surface: ConversationSurface;
  ready: boolean;
  hideSessionChrome: boolean;
  compact: boolean;
}

export function resolveConversationSurfaceAppearance(input: {
  surface: ConversationSurface;
  hasHydrated: boolean;
}): ConversationSurfaceAppearance {
  if (!input.hasHydrated) {
    return {
      surface: "agent",
      ready: false,
      hideSessionChrome: false,
      compact: false,
    };
  }
  return {
    surface: input.surface,
    ready: true,
    hideSessionChrome: input.surface === "tui",
    compact: input.surface === "tui",
  };
}

export function conversationSurfaceTestId(appearance: ConversationSurfaceAppearance): string {
  if (!appearance.ready) {
    return "conversation-surface-pending";
  }
  return `conversation-surface-${appearance.surface}`;
}

export function conversationSurfaceSubtitle(input: {
  providerLabel: string;
  surface: ConversationSurface;
  ready: boolean;
}): string {
  if (!input.ready) {
    return input.providerLabel;
  }
  if (input.surface === "tui") {
    return `${input.providerLabel} TUI`;
  }
  return `${input.providerLabel} agent`;
}
