import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectConversationSurface, useConversationSurfaceStore } from "./store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("conversation surface store", () => {
  beforeEach(() => {
    useConversationSurfaceStore.setState({ surfaceByAgentId: {} });
  });

  it("defaults each session to the Agent display", () => {
    expect(selectConversationSurface(useConversationSurfaceStore.getState(), "agent-1")).toBe(
      "agent",
    );
    expect(selectConversationSurface(useConversationSurfaceStore.getState(), null)).toBe("agent");
  });

  it("remembers the TUI display on the same session id", () => {
    useConversationSurfaceStore.getState().setSurface("agent-1", "tui");
    useConversationSurfaceStore.getState().setSurface("agent-2", "agent");

    expect(selectConversationSurface(useConversationSurfaceStore.getState(), "agent-1")).toBe(
      "tui",
    );
    expect(selectConversationSurface(useConversationSurfaceStore.getState(), "agent-2")).toBe(
      "agent",
    );
  });
});
