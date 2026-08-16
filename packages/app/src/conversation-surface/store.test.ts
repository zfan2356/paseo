import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pruneDeadSurfacesForServer,
  removeSurfacesForAgentIds,
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
    useConversationSurfaceStore.setState({
      surfaceByAgentId: {},
      seenAgentIdsByServerId: {},
      hasHydrated: true,
    });
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

  it("drops only agents this host previously saw and no longer has", () => {
    expect(
      removeSurfacesForAgentIds({ "agent-1": "tui", "agent-gone": "tui" }, ["agent-gone"]),
    ).toEqual({ "agent-1": "tui" });
    expect(
      pruneDeadSurfacesForServer({
        surfaceByAgentId: { "agent-local": "tui", "agent-relay": "tui" },
        seenAgentIds: [],
        liveAgentIds: ["agent-local"],
      }),
    ).toEqual({
      surfaceByAgentId: { "agent-local": "tui", "agent-relay": "tui" },
      seenAgentIds: ["agent-local"],
    });
    expect(
      pruneDeadSurfacesForServer({
        surfaceByAgentId: { "agent-local": "tui", "agent-relay": "tui" },
        seenAgentIds: ["agent-local"],
        liveAgentIds: [],
      }),
    ).toEqual({
      surfaceByAgentId: { "agent-relay": "tui" },
      seenAgentIds: [],
    });

    useConversationSurfaceStore.setState({
      surfaceByAgentId: { "agent-local": "tui", "agent-relay": "tui" },
      seenAgentIdsByServerId: {},
    });
    useConversationSurfaceStore.getState().pruneToAgentIds("local", ["agent-local"]);
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({
      "agent-local": "tui",
      "agent-relay": "tui",
    });
    useConversationSurfaceStore.getState().pruneToAgentIds("local", []);
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({
      "agent-relay": "tui",
    });
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
