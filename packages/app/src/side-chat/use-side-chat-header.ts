import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useIsCompactFormFactor } from "@/constants/layout";
import { conversationSessionRefFromTabTarget } from "@/conversation-surface/session";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { toggleTabInSidePanel, openTabInSidePanel } from "@/workspace-tabs/side-panel";
import { canOfferSideChat, resolveSideChatHeaderChrome } from "./chrome";
import { closeSideChatPanel, openSideChatPanel } from "./lifecycle";
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
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const sessionRef = conversationSessionRefFromTabTarget(activeTab?.target ?? null);
  const agentId = sessionRef?.agentId ?? null;
  const client = useHostRuntimeClient(serverId);
  const featureEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSideChatFork === true,
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
    const currentPanel = selectSideChatPanel(useSideChatStore.getState(), key);

    if (isCompact) {
      // Compact keeps the in-panel overlay: no side panel pane to dock into,
      // so the toggle still opens and destroys the fork.
      if (currentPanel) {
        void closeSideChatPanel({
          key,
          serverId,
          parentAgentId: agentId,
          client,
        }).catch((error) => {
          toast.error(error instanceof Error ? error.message : t("common.errors.error"));
        });
        return;
      }
      if (!client) return;
      void openSideChatPanel({ key, serverId, parentAgentId: agentId, client });
      return;
    }

    // Desktop: the side chat lives in the Side panel. The toggle only
    // reveals or hides the tab; closing the tab (its ✕) destroys the fork.
    const target: WorkspaceTabTarget = { kind: "side_chat", parentAgentId: agentId };
    if (!currentPanel) {
      if (!client) return;
      void openSideChatPanel({ key, serverId, parentAgentId: agentId, client });
      openTabInSidePanel({ isCompact, workspaceKey, checkout: null, target });
      return;
    }
    toggleTabInSidePanel({ isCompact, workspaceKey, checkout: null, target });
  }, [agentId, client, isCompact, key, serverId, t, toast, workspaceKey]);
  return { show: chrome.show, disabled: chrome.disabled, isOpen, toggle };
}
