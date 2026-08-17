import { describe, expect, it } from "vitest";
import {
  canOfferConversationSurfaceSwitch,
  conversationSessionRefFromAgentId,
  conversationSessionRefFromTabTarget,
  isConversationTerminalProvider,
} from "./session";

const supported = { supported: true, supportsLegacyCodex: false };

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

  it("offers the TUI switch only for live Codex, Claude, or Cursor sessions", () => {
    expect(isConversationTerminalProvider("codex")).toBe(true);
    expect(isConversationTerminalProvider("mock")).toBe(false);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "codex", persistence: { sessionId: "thread-1" } },
        supported,
      ),
    ).toBe(true);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "claude", persistence: { sessionId: "session-1" } },
        supported,
      ),
    ).toBe(true);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "cursor", persistence: { sessionId: "chat-1" } },
        supported,
      ),
    ).toBe(true);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "codex", persistence: { sessionId: null } },
        supported,
      ),
    ).toBe(false);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "mock", persistence: { sessionId: "mock-1" } },
        supported,
      ),
    ).toBe(false);
    expect(
      canOfferConversationSurfaceSwitch(
        {
          archivedAt: "2026-08-16T00:00:00.000Z",
          provider: "codex",
          persistence: { sessionId: "thread-1" },
        },
        supported,
      ),
    ).toBe(false);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "codex", persistence: { sessionId: "thread-1" } },
        { supported: false, supportsLegacyCodex: true },
      ),
    ).toBe(true);
    expect(
      canOfferConversationSurfaceSwitch(
        { archivedAt: null, provider: "claude", persistence: { sessionId: "session-1" } },
        { supported: false, supportsLegacyCodex: true },
      ),
    ).toBe(false);
    expect(canOfferConversationSurfaceSwitch(null, supported)).toBe(false);
  });
});
