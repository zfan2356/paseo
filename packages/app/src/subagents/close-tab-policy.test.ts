import { SIDE_CHAT_PARENT_LABEL } from "@getpaseo/protocol/agent-labels";
import { describe, expect, it } from "vitest";
import { resolveCloseAgentTabPolicy } from "./close-tab-policy";

describe("resolveCloseAgentTabPolicy", () => {
  it("archives root agents when their tab closes", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: null, labels: {} })).toEqual({
      kind: "archive-on-close",
    });
  });

  it("keeps subagent tab close layout-only", () => {
    expect(resolveCloseAgentTabPolicy({ parentAgentId: "parent-agent", labels: {} })).toEqual({
      kind: "layout-only",
    });
  });

  it("keeps side chat tab close layout-only", () => {
    expect(
      resolveCloseAgentTabPolicy({
        parentAgentId: null,
        labels: { [SIDE_CHAT_PARENT_LABEL]: "parent-agent" },
      }),
    ).toEqual({ kind: "layout-only" });
  });

  it("preserves the existing archive fallback when the agent is missing", () => {
    expect(resolveCloseAgentTabPolicy(null)).toEqual({ kind: "archive-on-close" });
    expect(resolveCloseAgentTabPolicy(undefined)).toEqual({ kind: "archive-on-close" });
  });
});
