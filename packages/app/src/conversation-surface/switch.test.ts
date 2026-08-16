import { describe, expect, it } from "vitest";
import {
  conversationSurfaceSubtitle,
  conversationSurfaceTestId,
  resolveConversationSurfaceAppearance,
} from "./display";
import { planConversationViewSwitch, toggleConversationSurface } from "./switch";

describe("conversation view switch", () => {
  it("keeps one session and only flips the display surface", () => {
    const session = { agentId: "agent-1" };

    expect(
      planConversationViewSwitch({
        session,
        surface: "agent",
        leftoverTerminalId: null,
        focusedLinkedTerminalId: null,
        canReleaseLeftover: false,
      }),
    ).toEqual({
      action: "toggle-surface",
      session,
      nextSurface: "tui",
    });
    expect(toggleConversationSurface("tui")).toBe("agent");
  });

  it("releases a leftover PTY before flipping the Agent-tab display", () => {
    const session = { agentId: "agent-1" };
    expect(
      planConversationViewSwitch({
        session,
        surface: "agent",
        leftoverTerminalId: "term-legacy",
        focusedLinkedTerminalId: null,
        canReleaseLeftover: true,
      }),
    ).toEqual({
      action: "release-then-toggle",
      session,
      terminalId: "term-legacy",
      nextSurface: "tui",
    });
  });

  it("flips only the display when leftover release is not available", () => {
    const session = { agentId: "agent-1" };
    expect(
      planConversationViewSwitch({
        session,
        surface: "agent",
        leftoverTerminalId: "term-legacy",
        focusedLinkedTerminalId: null,
        canReleaseLeftover: false,
      }),
    ).toEqual({
      action: "toggle-surface",
      session,
      nextSurface: "tui",
    });
  });

  it("does not plan a terminal create, retarget, or second tab", () => {
    const plan = planConversationViewSwitch({
      session: { agentId: "agent-1" },
      surface: "agent",
      leftoverTerminalId: null,
      focusedLinkedTerminalId: null,
      canReleaseLeftover: false,
    });

    expect(plan).not.toMatchObject({ action: "create-terminal" });
    expect(plan).not.toMatchObject({ action: "retarget-tab" });
    expect(plan).toMatchObject({ action: "toggle-surface", nextSurface: "tui" });
  });

  it("leaves a leftover linked PTY when that terminal tab is focused", () => {
    expect(
      planConversationViewSwitch({
        session: null,
        surface: "agent",
        leftoverTerminalId: null,
        focusedLinkedTerminalId: "term-legacy",
        canReleaseLeftover: false,
      }),
    ).toEqual({
      action: "leave-linked-terminal",
      terminalId: "term-legacy",
    });
    expect(
      planConversationViewSwitch({
        session: null,
        surface: "agent",
        leftoverTerminalId: null,
        focusedLinkedTerminalId: null,
        canReleaseLeftover: false,
      }),
    ).toEqual({ action: "none" });
  });

  it("keeps Agent and TUI as labels over the same provider session", () => {
    expect(
      conversationSurfaceSubtitle({ providerLabel: "Codex", surface: "agent", ready: true }),
    ).toBe("Codex agent");
    expect(
      conversationSurfaceSubtitle({ providerLabel: "Codex", surface: "tui", ready: true }),
    ).toBe("Codex TUI");
    expect(
      conversationSurfaceSubtitle({ providerLabel: "Codex", surface: "tui", ready: false }),
    ).toBe("Codex");
  });

  it("withholds TUI chrome until the surface store has hydrated", () => {
    expect(resolveConversationSurfaceAppearance({ surface: "tui", hasHydrated: false })).toEqual({
      surface: "agent",
      ready: false,
      hideSessionChrome: false,
      compact: false,
    });
    expect(resolveConversationSurfaceAppearance({ surface: "tui", hasHydrated: true })).toEqual({
      surface: "tui",
      ready: true,
      hideSessionChrome: true,
      compact: true,
    });
    expect(
      conversationSurfaceTestId(
        resolveConversationSurfaceAppearance({ surface: "tui", hasHydrated: false }),
      ),
    ).toBe("conversation-surface-pending");
    expect(
      conversationSurfaceTestId(
        resolveConversationSurfaceAppearance({ surface: "tui", hasHydrated: true }),
      ),
    ).toBe("conversation-surface-tui");
  });
});
