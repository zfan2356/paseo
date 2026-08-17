import { describe, expect, it } from "vitest";
import { planConversationViewSwitch } from "./switch";

describe("conversation view switch", () => {
  it("opens a conversation PTY for the same Agent session", () => {
    const session = { agentId: "agent-1" };

    expect(
      planConversationViewSwitch({
        session,
        leftoverTerminalId: null,
        focusedLinkedTerminalId: null,
        canOpenTerminal: true,
      }),
    ).toEqual({
      action: "open-terminal",
      session,
      terminalId: null,
    });
  });

  it("reuses an existing conversation PTY instead of creating a second one", () => {
    const session = { agentId: "agent-1" };
    expect(
      planConversationViewSwitch({
        session,
        leftoverTerminalId: "term-linked",
        focusedLinkedTerminalId: null,
        canOpenTerminal: false,
      }),
    ).toEqual({
      action: "open-terminal",
      session,
      terminalId: "term-linked",
    });
  });

  it("does not plan a display-only TUI overlay", () => {
    const plan = planConversationViewSwitch({
      session: { agentId: "agent-1" },
      leftoverTerminalId: null,
      focusedLinkedTerminalId: null,
      canOpenTerminal: true,
    });

    expect(plan).not.toMatchObject({ action: "toggle-surface" });
    expect(plan).toMatchObject({ action: "open-terminal", terminalId: null });
  });

  it("does not open a conversation PTY when the host cannot create one", () => {
    expect(
      planConversationViewSwitch({
        session: { agentId: "agent-1" },
        leftoverTerminalId: null,
        focusedLinkedTerminalId: null,
        canOpenTerminal: false,
      }),
    ).toEqual({ action: "none" });
  });

  it("leaves a linked conversation PTY when that terminal tab is focused", () => {
    expect(
      planConversationViewSwitch({
        session: null,
        leftoverTerminalId: null,
        focusedLinkedTerminalId: "term-linked",
        canOpenTerminal: false,
      }),
    ).toEqual({
      action: "leave-linked-terminal",
      terminalId: "term-linked",
    });
    expect(
      planConversationViewSwitch({
        session: null,
        leftoverTerminalId: null,
        focusedLinkedTerminalId: null,
        canOpenTerminal: false,
      }),
    ).toEqual({ action: "none" });
  });
});
