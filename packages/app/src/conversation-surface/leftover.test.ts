import { describe, expect, it } from "vitest";
import {
  collectLeaseBlockedAgentIds,
  collectLinkedAgentIds,
  collectPaneFocusedTargets,
  findFocusedLinkedConversationTerminal,
  findLinkedConversationTerminal,
  findTerminalTabId,
  isLeftoverVisibleInAnyPane,
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

  it("collects every agent that still holds a leftover lease", () => {
    expect(
      collectLinkedAgentIds([
        { linkedAgentId: "agent-1" },
        { linkedAgentId: null },
        { linkedAgentId: "agent-2" },
        { linkedAgentId: "agent-1" },
      ]),
    ).toEqual(["agent-1", "agent-2"]);
    expect(collectLeaseBlockedAgentIds([{ linkedAgentId: "agent-1" }], "agent-1")).toEqual([
      "agent-1",
    ]);
    expect(collectLeaseBlockedAgentIds([{ linkedAgentId: "agent-1" }], "agent-pending")).toEqual([
      "agent-1",
      "agent-pending",
    ]);
    expect(collectLeaseBlockedAgentIds([], null)).toEqual([]);
  });

  it("auto-releases a leftover PTY only when no pane is looking at it", () => {
    expect(
      shouldAutoReleaseLeftoverTerminal({
        focusedAgentId: "agent-1",
        leftoverTerminalId: "term-linked",
        leftoverVisibleInAnyPane: false,
      }),
    ).toBe(true);
    expect(
      shouldAutoReleaseLeftoverTerminal({
        focusedAgentId: "agent-1",
        leftoverTerminalId: "term-linked",
        leftoverVisibleInAnyPane: true,
      }),
    ).toBe(false);
    expect(
      shouldAutoReleaseLeftoverTerminal({
        focusedAgentId: null,
        leftoverTerminalId: "term-linked",
        leftoverVisibleInAnyPane: false,
      }),
    ).toBe(false);
  });

  it("treats a leftover as visible when any pane's focused tab is that terminal", () => {
    const tabs = [
      { tabId: "agent_a", target: { kind: "agent" } },
      { tabId: "terminal_t", target: { kind: "terminal", terminalId: "term-linked" } },
    ];
    expect(
      collectPaneFocusedTargets(
        [{ focusedTabId: "agent_a" }, { focusedTabId: "terminal_t" }],
        tabs,
      ),
    ).toEqual([{ kind: "agent" }, { kind: "terminal", terminalId: "term-linked" }]);
    expect(
      isLeftoverVisibleInAnyPane("term-linked", [
        { kind: "agent" },
        { kind: "terminal", terminalId: "term-linked" },
      ]),
    ).toBe(true);
    expect(
      isLeftoverVisibleInAnyPane("term-linked", [
        { kind: "agent" },
        { kind: "terminal", terminalId: "term-other" },
      ]),
    ).toBe(false);
    expect(
      isLeftoverVisibleInAnyPane(
        "term-linked",
        collectPaneFocusedTargets([{ focusedTabId: "agent_a" }, { focusedTabId: "agent_a" }], tabs),
      ),
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
