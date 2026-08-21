import { useCallback } from "react";

import { conversationSessionRefFromTabTarget } from "@/conversation-surface/session";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { canOfferSideChat, resolveSideChatHeaderChrome } from "./chrome";
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
  activeTab: { target: WorkspaceTabTarget } | null | undefined;
  isConnected: boolean;
}): SideChatHeaderState {
  const { serverId, activeTab, isConnected } = input;
  const sessionRef = conversationSessionRefFromTabTarget(activeTab?.target ?? null);
  const agentId = sessionRef?.agentId ?? null;
  const featureEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSideQuestion === true,
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
  const isOpen = useSideChatStore((state) =>
    key ? selectSideChatPanel(state, key).isOpen : false,
  );
  const toggle = useCallback(() => {
    if (key) {
      useSideChatStore.getState().togglePanel(key);
    }
  }, [key]);
  return { show: chrome.show, disabled: chrome.disabled, isOpen, toggle };
}
