const SIDE_CHAT_KEY_SEPARATOR = "\0";

export type SideChatPanelState =
  | { status: "history"; generation: number }
  | { status: "opening"; generation: number; sideAgentId?: string }
  | { status: "ready"; generation: number; sideAgentId: string }
  | { status: "error"; generation: number; error: string; sideAgentId?: string };

export function sideChatKey(serverId: string, agentId: string): string {
  return `${serverId}${SIDE_CHAT_KEY_SEPARATOR}${agentId}`;
}

export function isSideChatKeyForServer(key: string, serverId: string): boolean {
  return key.startsWith(`${serverId}${SIDE_CHAT_KEY_SEPARATOR}`);
}
