import { SIDE_CHAT_PARENT_LABEL } from "@getpaseo/protocol/agent-labels";

export function getSideChatParentId(agent: {
  internal?: boolean;
  labels: Record<string, string>;
}): string | null {
  return agent.internal ? (agent.labels[SIDE_CHAT_PARENT_LABEL] ?? null) : null;
}
