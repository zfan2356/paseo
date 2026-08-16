import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pruneSurfaceByAgentId,
  selectConversationSurface,
  useConversationSurfaceStore,
} from "./store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("conversation surface store", () => {
  beforeEach(() => {
    useConversationSurfaceStore.setState({ surfaceByAgentId: {}, hasHydrated: true });
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

  it("drops surfaces for agents that are no longer live", () => {
    expect(pruneSurfaceByAgentId({ "agent-1": "tui", "agent-gone": "tui" }, ["agent-1"])).toEqual({
      "agent-1": "tui",
    });
    useConversationSurfaceStore.setState({
      surfaceByAgentId: { "agent-1": "tui", "agent-gone": "agent" },
    });
    useConversationSurfaceStore.getState().pruneToAgentIds(["agent-1"]);
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({ "agent-1": "tui" });
  });

  it("marks persist hydration without rewriting surfaces", () => {
    useConversationSurfaceStore.setState({
      surfaceByAgentId: { "agent-1": "tui" },
      hasHydrated: false,
    });
    useConversationSurfaceStore.getState().markHydrated();
    expect(useConversationSurfaceStore.getState()).toMatchObject({
      surfaceByAgentId: { "agent-1": "tui" },
      hasHydrated: true,
    });
  });
});
