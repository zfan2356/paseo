import { describe, expect, it, vi } from "vitest";
import { releaseConversationTerminalOwner } from "./release";

describe("releaseConversationTerminalOwner", () => {
  it("uses the Agent switch RPC when the host can hydrate leftover TUI turns", async () => {
    const fetchTimeline = vi.fn(async () => undefined);
    const agentId = await releaseConversationTerminalOwner({
      terminalId: "term-1",
      agentId: "agent-1",
      canSwitchToAgent: true,
      canSwitchLegacyCodex: false,
      fetchTimeline,
      failedMessage: "failed",
      client: {
        switchAgentTerminalToAgent: async () => ({ success: true, agentId: "agent-1" }),
        killTerminal: async () => {
          throw new Error("should not kill when switch RPC exists");
        },
      },
    });

    expect(agentId).toBe("agent-1");
    expect(fetchTimeline).toHaveBeenCalledWith("agent-1");
  });

  it("kills the leftover PTY when the host has no switch RPC", async () => {
    const killTerminal = vi.fn(async () => ({ success: true }));
    const fetchTimeline = vi.fn(async () => undefined);
    const agentId = await releaseConversationTerminalOwner({
      terminalId: "term-1",
      agentId: "agent-1",
      canSwitchToAgent: false,
      canSwitchLegacyCodex: false,
      fetchTimeline,
      failedMessage: "failed",
      client: {
        killTerminal,
      },
    });

    expect(agentId).toBe("agent-1");
    expect(killTerminal).toHaveBeenCalledWith("term-1");
    expect(fetchTimeline).toHaveBeenCalledWith("agent-1");
  });

  it("uses the legacy Codex switch RPC when that is the only hydrate path", async () => {
    const fetchTimeline = vi.fn(async () => undefined);
    const agentId = await releaseConversationTerminalOwner({
      terminalId: "term-1",
      agentId: "agent-1",
      canSwitchToAgent: false,
      canSwitchLegacyCodex: true,
      fetchTimeline,
      failedMessage: "failed",
      client: {
        switchCodexTerminalToAgent: async () => ({ success: true, agentId: "agent-1" }),
        killTerminal: async () => {
          throw new Error("should not kill when legacy switch RPC exists");
        },
      },
    });

    expect(agentId).toBe("agent-1");
    expect(fetchTimeline).toHaveBeenCalledWith("agent-1");
  });
});
