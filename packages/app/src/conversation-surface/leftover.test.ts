import { describe, expect, it } from "vitest";
import {
  collectLeaseBlockedAgentIds,
  collectLinkedAgentIds,
  findFocusedLinkedConversationTerminal,
  findLinkedConversationTerminal,
  findTerminalTabId,
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
