import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationSurfaceKey,
  pruneDeadSurfacesForServer,
  removeSurfacesForAgentIds,
  selectConversationSurface,
  selectLeaseBlocked,
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
      leaseBlockedByKey: {},
      hasHydrated: true,
    });
  });

  it("defaults each session to the Agent display", () => {
    expect(
      selectConversationSurface(useConversationSurfaceStore.getState(), "local", "agent-1"),
    ).toBe("agent");
    expect(selectConversationSurface(useConversationSurfaceStore.getState(), "local", null)).toBe(
      "agent",
    );
  });

  it("remembers the TUI display per host and session id", () => {
    useConversationSurfaceStore.getState().setSurface("local", "agent-1", "tui");
    useConversationSurfaceStore.getState().setSurface("local", "agent-2", "agent");
    useConversationSurfaceStore.getState().setSurface("relay", "agent-1", "agent");

    expect(
      selectConversationSurface(useConversationSurfaceStore.getState(), "local", "agent-1"),
    ).toBe("tui");
    expect(
      selectConversationSurface(useConversationSurfaceStore.getState(), "local", "agent-2"),
    ).toBe("agent");
    expect(
      selectConversationSurface(useConversationSurfaceStore.getState(), "relay", "agent-1"),
    ).toBe("agent");
  });

  it("reads a legacy unscoped key until the next write namespaces it", () => {
    useConversationSurfaceStore.setState({
      surfaceByAgentId: { "agent-1": "tui" },
    });
    expect(
      selectConversationSurface(useConversationSurfaceStore.getState(), "local", "agent-1"),
    ).toBe("tui");

    useConversationSurfaceStore.getState().setSurface("local", "agent-1", "tui");
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({
      [conversationSurfaceKey("local", "agent-1")]: "tui",
    });
  });

  it("drops only agents this host previously saw and no longer has", () => {
    expect(
      removeSurfacesForAgentIds({ "agent-1": "tui", "agent-gone": "tui" }, ["agent-gone"]),
    ).toEqual({ "agent-1": "tui" });
    expect(
      pruneDeadSurfacesForServer({
        serverId: "local",
        surfaceByAgentId: {
          [conversationSurfaceKey("local", "agent-local")]: "tui",
          [conversationSurfaceKey("relay", "agent-relay")]: "tui",
        },
        seenAgentIds: [],
        liveAgentIds: ["agent-local"],
      }),
    ).toEqual({
      surfaceByAgentId: {
        [conversationSurfaceKey("local", "agent-local")]: "tui",
        [conversationSurfaceKey("relay", "agent-relay")]: "tui",
      },
      seenAgentIds: ["agent-local"],
    });
    expect(
      pruneDeadSurfacesForServer({
        serverId: "local",
        surfaceByAgentId: {
          [conversationSurfaceKey("local", "agent-local")]: "tui",
          [conversationSurfaceKey("relay", "agent-relay")]: "tui",
          "agent-local": "tui",
        },
        seenAgentIds: ["agent-local"],
        liveAgentIds: [],
      }),
    ).toEqual({
      surfaceByAgentId: {
        [conversationSurfaceKey("relay", "agent-relay")]: "tui",
      },
      seenAgentIds: [],
    });

    useConversationSurfaceStore.setState({
      surfaceByAgentId: {
        [conversationSurfaceKey("local", "agent-local")]: "tui",
        [conversationSurfaceKey("relay", "agent-relay")]: "tui",
      },
      seenAgentIdsByServerId: {},
    });
    useConversationSurfaceStore.getState().pruneToAgentIds("local", ["agent-local"]);
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({
      [conversationSurfaceKey("local", "agent-local")]: "tui",
      [conversationSurfaceKey("relay", "agent-relay")]: "tui",
    });
    expect(useConversationSurfaceStore.getState().seenAgentIdsByServerId).toEqual({
      local: ["agent-local"],
    });
    useConversationSurfaceStore.getState().pruneToAgentIds("local", []);
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({
      [conversationSurfaceKey("relay", "agent-relay")]: "tui",
    });
    expect(useConversationSurfaceStore.getState().seenAgentIdsByServerId).toEqual({
      local: [],
    });
  });

  it("prunes persisted seen agents on the first hydrate after restart", () => {
    useConversationSurfaceStore.setState({
      surfaceByAgentId: {
        [conversationSurfaceKey("local", "agent-gone")]: "tui",
        [conversationSurfaceKey("relay", "agent-relay")]: "tui",
      },
      seenAgentIdsByServerId: { local: ["agent-gone"] },
    });
    useConversationSurfaceStore.getState().pruneToAgentIds("local", []);
    expect(useConversationSurfaceStore.getState().surfaceByAgentId).toEqual({
      [conversationSurfaceKey("relay", "agent-relay")]: "tui",
    });
  });

  it("blocks send while a leftover lease is still held on this host", () => {
    useConversationSurfaceStore.getState().replaceLeaseBlocked("local", ["agent-1"]);
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "local", "agent-1")).toBe(
      true,
    );
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "local", "agent-2")).toBe(
      false,
    );
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "relay", "agent-1")).toBe(
      false,
    );

    useConversationSurfaceStore.getState().replaceLeaseBlocked("relay", ["agent-1"]);
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "local", "agent-1")).toBe(
      true,
    );
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "relay", "agent-1")).toBe(
      true,
    );

    useConversationSurfaceStore.getState().replaceLeaseBlocked("local", []);
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "local", "agent-1")).toBe(
      false,
    );
    expect(selectLeaseBlocked(useConversationSurfaceStore.getState(), "relay", "agent-1")).toBe(
      true,
    );
  });

  it("marks persist hydration without rewriting surfaces", () => {
    useConversationSurfaceStore.setState({
      surfaceByAgentId: { [conversationSurfaceKey("local", "agent-1")]: "tui" },
      hasHydrated: false,
    });
    useConversationSurfaceStore.getState().markHydrated();
    expect(useConversationSurfaceStore.getState()).toMatchObject({
      surfaceByAgentId: { [conversationSurfaceKey("local", "agent-1")]: "tui" },
      hasHydrated: true,
    });
  });
});
