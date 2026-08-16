import { describe, expect, it } from "vitest";
import { conversationSurfaceSubtitle } from "./display";
import { planConversationViewSwitch, toggleConversationSurface } from "./switch";

describe("conversation view switch", () => {
  it("keeps one session and only flips the display surface", () => {
    const session = { agentId: "agent-1" };

    expect(
      planConversationViewSwitch({
        session,
        surface: "agent",
        linkedTerminalId: null,
      }),
    ).toEqual({
      action: "toggle-surface",
      session,
      nextSurface: "tui",
    });
    expect(
      planConversationViewSwitch({
        session,
        surface: "tui",
        linkedTerminalId: "term-legacy",
      }),
    ).toEqual({
      action: "toggle-surface",
      session,
      nextSurface: "agent",
    });
    expect(toggleConversationSurface("tui")).toBe("agent");
  });

  it("does not plan a terminal create, retarget, or second tab", () => {
    const plan = planConversationViewSwitch({
      session: { agentId: "agent-1" },
      surface: "agent",
      linkedTerminalId: null,
    });

    expect(plan).not.toMatchObject({ action: "create-terminal" });
    expect(plan).not.toMatchObject({ action: "retarget-tab" });
    expect(plan).not.toMatchObject({ replaceTabId: expect.anything() });
    expect(plan).toMatchObject({ action: "toggle-surface", nextSurface: "tui" });
  });

  it("leaves a leftover linked PTY without using it as the TUI display", () => {
    expect(
      planConversationViewSwitch({
        session: null,
        surface: "agent",
        linkedTerminalId: "term-legacy",
      }),
    ).toEqual({
      action: "leave-linked-terminal",
      terminalId: "term-legacy",
    });
    expect(
      planConversationViewSwitch({
        session: null,
        surface: "agent",
        linkedTerminalId: null,
      }),
    ).toEqual({ action: "none" });
  });

  it("keeps Agent and TUI as labels over the same provider session", () => {
    expect(conversationSurfaceSubtitle({ providerLabel: "Codex", surface: "agent" })).toBe(
      "Codex agent",
    );
    expect(conversationSurfaceSubtitle({ providerLabel: "Codex", surface: "tui" })).toBe(
      "Codex TUI",
    );
  });
});
