import { describe, expect, it } from "vitest";
import {
  findFocusedLinkedConversationTerminal,
  findLinkedConversationTerminal,
  findTerminalTabId,
  shouldAutoReleaseLeftoverTerminal,
} from "./leftover";

describe("leftover conversation terminals", () => {
  it("finds the linked PTY for the same Agent session", () => {
    expect(
      findLinkedConversationTerminal(
        [{ id: "term-plain" }, { id: "term-linked", linkedAgentId: "agent-1" }],
        "agent-1",
      ),
    ).toEqual({ id: "term-linked", linkedAgentId: "agent-1" });
    expect(findLinkedConversationTerminal([{ id: "term-plain" }], "agent-1")).toBeNull();
  });

  it("auto-releases a leftover PTY only when the Agent display is focused", () => {
    expect(
      shouldAutoReleaseLeftoverTerminal({
        focusedAgentId: "agent-1",
        leftoverTerminalId: "term-linked",
        focusedLinkedTerminalId: null,
      }),
    ).toBe(true);
    expect(
      shouldAutoReleaseLeftoverTerminal({
        focusedAgentId: null,
        leftoverTerminalId: "term-linked",
        focusedLinkedTerminalId: "term-linked",
      }),
    ).toBe(false);
  });

  it("treats a focused terminal tab as leftover only when it is linked", () => {
    expect(
      findFocusedLinkedConversationTerminal([{ id: "term-linked", linkedAgentId: "agent-1" }], {
        kind: "terminal",
        terminalId: "term-linked",
      }),
    ).toEqual({ id: "term-linked", linkedAgentId: "agent-1" });
    expect(
      findFocusedLinkedConversationTerminal([{ id: "term-plain" }], {
        kind: "terminal",
        terminalId: "term-plain",
      }),
    ).toBeNull();
  });

  it("finds the workspace tab that still hosts the leftover PTY", () => {
    expect(
      findTerminalTabId(
        [
          { tabId: "agent_a", target: { kind: "agent" } },
          { tabId: "terminal_t", target: { kind: "terminal", terminalId: "term-linked" } },
        ],
        "term-linked",
      ),
    ).toBe("terminal_t");
  });
});
