import type { ConversationSurface } from "./switch";

export function conversationSurfaceSubtitle(input: {
  providerLabel: string;
  surface: ConversationSurface;
}): string {
  if (input.surface === "tui") {
    return `${input.providerLabel} TUI`;
  }
  return `${input.providerLabel} agent`;
}
