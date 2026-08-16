import { describe, expect, it } from "vitest";
import { resolveConversationViewSwitchChrome } from "./chrome";

describe("conversation view switch chrome", () => {
  it("shows the TUI label on the Agent display without requiring a live host", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        surface: "agent",
        isFocusedOnLinkedTerminal: false,
        isPending: false,
        isConnected: false,
        hasWorkspaceDirectory: false,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToTuiView",
      disabled: false,
    });
  });

  it("shows the Agent label on the TUI display", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        surface: "tui",
        isFocusedOnLinkedTerminal: false,
        isPending: false,
        isConnected: true,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToAgentView",
      disabled: false,
    });
  });

  it("keeps the Agent-tab display switch enabled while a leftover PTY still exists", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        surface: "agent",
        isFocusedOnLinkedTerminal: false,
        isPending: true,
        isConnected: false,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToTuiView",
      disabled: false,
    });
  });

  it("disables leave-linked host work when the leftover terminal tab is focused offline", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: null,
        surface: "agent",
        isFocusedOnLinkedTerminal: true,
        isPending: false,
        isConnected: false,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToAgentView",
      disabled: true,
    });
  });

  it("shows the Agent label when a leftover terminal tab is focused", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: null,
        surface: "agent",
        isFocusedOnLinkedTerminal: true,
        isPending: false,
        isConnected: true,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToAgentView",
      disabled: false,
    });
  });
});
