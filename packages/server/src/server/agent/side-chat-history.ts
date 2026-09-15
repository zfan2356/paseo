import { getSideChatParentIdFromLabels } from "@getpaseo/protocol/agent-labels";

export const SIDE_CHAT_INDEPENDENT_ARCHIVE_MESSAGE =
  "Side chats can only be archived with their parent conversation";
export const SIDE_CHAT_INDEPENDENT_UNARCHIVE_MESSAGE =
  "Side chats can only be restored with their parent conversation";

export class SideChatIndependentArchiveError extends Error {
  readonly parentAgentId: string;

  constructor(parentAgentId: string) {
    super(SIDE_CHAT_INDEPENDENT_ARCHIVE_MESSAGE);
    this.name = "SideChatIndependentArchiveError";
    this.parentAgentId = parentAgentId;
  }
}

export class SideChatIndependentUnarchiveError extends Error {
  readonly parentAgentId: string;

  constructor(parentAgentId: string) {
    super(SIDE_CHAT_INDEPENDENT_UNARCHIVE_MESSAGE);
    this.name = "SideChatIndependentUnarchiveError";
    this.parentAgentId = parentAgentId;
  }
}

export function getSideChatParentId(agent: {
  labels?: Record<string, string> | null;
}): string | null {
  return getSideChatParentIdFromLabels(agent.labels);
}
