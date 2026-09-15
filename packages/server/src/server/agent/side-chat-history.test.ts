import { describe, expect, test } from "vitest";
import { SIDE_CHAT_PARENT_LABEL } from "@getpaseo/protocol/agent-labels";

import {
  getSideChatParentId,
  SideChatIndependentArchiveError,
  SIDE_CHAT_INDEPENDENT_ARCHIVE_MESSAGE,
} from "./side-chat-history.js";

describe("side chat history identity", () => {
  test("follows the parent label even when internal was dropped", () => {
    expect(
      getSideChatParentId({
        labels: { [SIDE_CHAT_PARENT_LABEL]: "parent-agent" },
      }),
    ).toBe("parent-agent");
  });

  test("ignores agents that do not carry the side chat parent label", () => {
    expect(getSideChatParentId({ labels: { "paseo.parent-agent-id": "parent-agent" } })).toBeNull();
    expect(getSideChatParentId({ labels: {} })).toBeNull();
  });

  test("names the independent archive refusal", () => {
    const error = new SideChatIndependentArchiveError("parent-agent");
    expect(error).toBeInstanceOf(Error);
    expect(error.parentAgentId).toBe("parent-agent");
    expect(error.message).toBe(SIDE_CHAT_INDEPENDENT_ARCHIVE_MESSAGE);
  });
});
