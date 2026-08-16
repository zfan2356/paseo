import { describe, expect, it } from "vitest";
import { resolveConversationViewSwitchChrome } from "./chrome";

describe("conversation view switch chrome", () => {
  it("shows the TUI label on the Agent display of a live session", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        surface: "agent",
        hasLinkedTerminal: false,
        isLeavingLinkedTerminal: false,
        isConnected: true,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToConversationTerminal",
      disabled: false,
    });
  });

  it("shows the Agent label on the TUI display without requiring a live host", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        surface: "tui",
        hasLinkedTerminal: false,
        isLeavingLinkedTerminal: false,
        isConnected: false,
        hasWorkspaceDirectory: false,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToAgentView",
      disabled: false,
    });
  });

  it("disables only the leftover linked-terminal leave path", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: null,
        surface: "agent",
        hasLinkedTerminal: true,
        isLeavingLinkedTerminal: true,
        isConnected: true,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToAgentView",
      disabled: true,
    });
  });
});
