import { useCallback } from "react";

import { useIsCompactFormFactor } from "@/constants/layout";
import { conversationSessionRefFromTabTarget } from "@/conversation-surface/session";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { canOfferSideChat, resolveSideChatHeaderChrome } from "./chrome";
import { revealSideChatTab } from "./dock";
import { showSideChatHistory } from "./lifecycle";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

export interface SideChatHeaderState {
  show: boolean;
  disabled: boolean;
  isOpen: boolean;
  toggle: () => void;
}

export function useSideChatHeader(input: {
  serverId: string;
  workspaceKey: string | null;
  activeTab: { target: WorkspaceTabTarget } | null | undefined;
  isConnected: boolean;
}): SideChatHeaderState {
  const { serverId, workspaceKey, activeTab, isConnected } = input;
  const isCompact = useIsCompactFormFactor();
  const sessionRef = conversationSessionRefFromTabTarget(activeTab?.target ?? null);
  const agentId = sessionRef?.agentId ?? null;
  const featureEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSideChatHistory === true,
  );
  const agent = useSessionStore((state) => {
    if (!agentId) {
      return null;
    }
    const session = state.sessions[serverId];
    return session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
  });
  const canOffer = agentId !== null && canOfferSideChat(agent, { featureEnabled });
  const chrome = resolveSideChatHeaderChrome({ canOffer, isConnected });
  const key = agentId ? sideChatKey(serverId, agentId) : null;
  const panel = useSideChatStore((state) => (key ? selectSideChatPanel(state, key) : null));
  const isOpen = panel !== null;
  const toggle = useCallback(() => {
    if (!key || !agentId) return;
    showSideChatHistory(key);
    if (!isCompact) {
      revealSideChatTab({ workspaceKey, target: { kind: "side_chat", parentAgentId: agentId } });
    }
  }, [agentId, isCompact, key, workspaceKey]);
  return { show: chrome.show, disabled: chrome.disabled, isOpen, toggle };
}
