import type { SubscribeTerminalRequest } from "@getpaseo/protocol/messages";

// Visible-snapshot restore paints the current viewport only. Extra scrollback is
// encoded as ANSI and xterm replays those older rows top-down when a long TUI
// session is reopened.
export const TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES = 0;

export interface ResolveTerminalRestoreOptionsInput {
  supportsTerminalRestoreModes: boolean;
  canClaimSize: boolean;
  size: { rows: number; cols: number } | null;
}

export function resolveTerminalRestoreOptions(
  input: ResolveTerminalRestoreOptionsInput,
): SubscribeTerminalRequest["restore"] | undefined {
  if (!input.supportsTerminalRestoreModes) {
    return undefined;
  }

  return {
    mode: "visible-snapshot",
    scrollbackLines: TERMINAL_VISIBLE_RESTORE_SCROLLBACK_LINES,
    ...(input.canClaimSize && input.size ? { size: input.size } : {}),
  };
}

export function restoreSubscriptionSendsFrame(
  restore: SubscribeTerminalRequest["restore"] | undefined,
): boolean {
  return restore !== undefined && restore.mode !== "live";
}
