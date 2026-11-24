import { getSideChatParentIdFromLabels } from "@getpaseo/protocol/agent-labels";

import type { Agent } from "@/stores/session-store";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

export function resolveCloseAgentTabPolicy(
  agent: Pick<Agent, "parentAgentId" | "labels"> | null | undefined,
): CloseAgentTabPolicy {
  if (agent?.parentAgentId || getSideChatParentIdFromLabels(agent?.labels)) {
    return { kind: "layout-only" };
  }

  return { kind: "archive-on-close" };
}
