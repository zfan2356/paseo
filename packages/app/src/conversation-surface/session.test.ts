import { describe, expect, it } from "vitest";
import {
  canOfferConversationSurfaceSwitch,
  conversationSessionRefFromAgentId,
  conversationSessionRefFromTabTarget,
} from "./session";

describe("conversation session ref", () => {
  it("treats the Agent tab target as the only session record", () => {
    expect(conversationSessionRefFromTabTarget({ kind: "agent", agentId: " agent-1 " })).toEqual({
      agentId: "agent-1",
    });
    expect(conversationSessionRefFromAgentId("agent-1")).toEqual({ agentId: "agent-1" });
  });

  it("does not invent a second session when the tab is a terminal or draft", () => {
    expect(
      conversationSessionRefFromTabTarget({ kind: "terminal", terminalId: "term-1" }),
    ).toBeNull();
    expect(conversationSessionRefFromTabTarget({ kind: "draft", draftId: "draft-1" })).toBeNull();
    expect(conversationSessionRefFromAgentId("   ")).toBeNull();
  });

  it("offers the display switch only for a live persisted conversation", () => {
    expect(
      canOfferConversationSurfaceSwitch({
        provider: "codex",
        persistence: { sessionId: "sess-1" },
        archivedAt: null,
      }),
    ).toBe(true);
    expect(
      canOfferConversationSurfaceSwitch({
        provider: "mock",
        persistence: { sessionId: "sess-1" },
        archivedAt: null,
      }),
    ).toBe(false);
    expect(
      canOfferConversationSurfaceSwitch({
        provider: "codex",
        persistence: { sessionId: "sess-1" },
        archivedAt: "2026-08-16T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      canOfferConversationSurfaceSwitch({
        provider: "codex",
        persistence: { sessionId: null },
        archivedAt: null,
      }),
    ).toBe(false);
  });
});
