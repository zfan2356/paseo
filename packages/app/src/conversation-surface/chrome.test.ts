import { describe, expect, it } from "vitest";
import { resolveConversationViewSwitchChrome } from "./chrome";

describe("conversation view switch chrome", () => {
  it("shows the TUI label on an eligible Agent tab", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        isFocusedOnLinkedTerminal: false,
        isPending: false,
        isConnected: true,
        hasWorkspaceDirectory: true,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToTuiView",
      disabled: false,
    });
  });

  it("disables opening a conversation PTY without a live host", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: "agent-1",
        isFocusedOnLinkedTerminal: false,
        isPending: false,
        isConnected: false,
        hasWorkspaceDirectory: false,
      }),
    ).toEqual({
      show: true,
      labelKey: "workspace.header.actions.switchToTuiView",
      disabled: true,
    });
  });

  it("shows the Agent label on a linked conversation terminal tab", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: null,
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

  it("disables leaving a linked terminal while offline", () => {
    expect(
      resolveConversationViewSwitchChrome({
        agentId: null,
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
});
