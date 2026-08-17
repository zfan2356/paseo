import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import { resolveConversationViewSwitchChrome } from "./chrome";
import {
  collectLeaseBlockedAgentIds,
  findFocusedLinkedConversationTerminal,
  findLinkedConversationTerminal,
  findTerminalTabId,
} from "./leftover";
import {
  releaseConversationTerminalOwner,
  type ConversationTerminalReleaseClient,
} from "./release";
import { canOfferConversationSurfaceSwitch, conversationSessionRefFromTabTarget } from "./session";
import { useConversationSurfaceStore } from "./store";
import { planConversationViewSwitch } from "./switch";

interface ConversationSurfaceTerminal {
  id: string;
  linkedAgentId?: string | null;
}

interface ConversationSurfaceTab {
  tabId: string;
  target: { kind: string; terminalId?: string };
}

export interface ReleasedConversationTerminal {
  tabId: string | null;
  terminalId: string;
  closeTab: boolean;
}

export interface OpenConversationTerminalInput {
  agentId: string;
  terminalId: string | null;
  replaceTabId: string;
}

interface UseWorkspaceConversationSurfaceInput {
  activeTab: WorkspaceTabDescriptor | null;
  tabs: readonly ConversationSurfaceTab[];
  serverId: string;
  terminals: readonly ConversationSurfaceTerminal[];
  client: ConversationTerminalReleaseClient | null;
  isConnected: boolean;
  workspaceDirectory: string | null;
  supportsAgentConversationViewSwitch: boolean;
  supportsLegacyCodexConversationViewSwitch: boolean;
  isCreatePending: boolean;
  onOpenConversationTerminal: (input: OpenConversationTerminalInput) => void;
  onReleasedTerminal: (input: ReleasedConversationTerminal) => void;
  onRetargetToAgent: (agentId: string) => void;
  toast: { error: (message: string) => void };
  t: TFunction;
}

export function useWorkspaceConversationSurface(input: UseWorkspaceConversationSurfaceInput) {
  const {
    activeTab,
    tabs,
    serverId,
    terminals,
    client,
    isConnected,
    workspaceDirectory,
    supportsAgentConversationViewSwitch,
    supportsLegacyCodexConversationViewSwitch,
    isCreatePending,
    onOpenConversationTerminal,
    onReleasedTerminal,
    onRetargetToAgent,
    toast,
    t,
  } = input;

  const sessionRef = conversationSessionRefFromTabTarget(activeTab?.target ?? null);
  const focusedAgentId = sessionRef?.agentId ?? null;
  const focusedAgent = useSessionStore((state) => {
    if (!focusedAgentId) {
      return null;
    }
    const session = state.sessions[serverId];
    return (
      session?.agents?.get(focusedAgentId) ?? session?.agentDetails?.get(focusedAgentId) ?? null
    );
  });
  const agentId = canOfferConversationSurfaceSwitch(focusedAgent, {
    supported: supportsAgentConversationViewSwitch,
    supportsLegacyCodex: supportsLegacyCodexConversationViewSwitch,
  })
    ? focusedAgentId
    : null;
  const leftoverTerminal = findLinkedConversationTerminal(terminals, agentId);
  const leftoverTerminalId = leftoverTerminal?.id ?? null;
  const leftoverLinkedAgentId = leftoverTerminal?.linkedAgentId ?? null;
  const focusedLinkedTerminal = findFocusedLinkedConversationTerminal(
    terminals,
    activeTab?.target ?? null,
  );
  const focusedLinkedTerminalId = focusedLinkedTerminal?.id ?? null;
  const replaceLeaseBlocked = useConversationSurfaceStore((state) => state.replaceLeaseBlocked);
  const [isPending, setIsPending] = useState(false);
  const releaseInFlightRef = useRef<Promise<string | null> | null>(null);

  const chrome = useMemo(
    () =>
      resolveConversationViewSwitchChrome({
        agentId,
        isFocusedOnLinkedTerminal: focusedLinkedTerminalId !== null,
        isPending: isPending || isCreatePending,
        isConnected,
        hasWorkspaceDirectory: Boolean(workspaceDirectory),
      }),
    [agentId, focusedLinkedTerminalId, isConnected, isCreatePending, isPending, workspaceDirectory],
  );

  const fetchTimeline = useCallback(
    async (releasedAgentId: string) => {
      const sessionState = useSessionStore.getState().sessions[serverId];
      const currentCursor = sessionState?.agentTimelineCursor.get(releasedAgentId);
      await getHostRuntimeStore().fetchAgentTimeline(serverId, releasedAgentId, {
        direction: "tail",
        projection: "projected",
        ...(currentCursor
          ? { cursor: { epoch: currentCursor.epoch, seq: currentCursor.endSeq } }
          : {}),
      });
    },
    [serverId],
  );

  const releaseTerminal = useCallback(
    async (terminalId: string, sessionAgentId: string, closeTab: boolean) => {
      if (!client) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      if (releaseInFlightRef.current) {
        return releaseInFlightRef.current;
      }
      const pending = releaseConversationTerminalOwner({
        terminalId,
        agentId: sessionAgentId,
        client,
        canSwitchToAgent: supportsAgentConversationViewSwitch,
        canSwitchLegacyCodex: supportsLegacyCodexConversationViewSwitch,
        fetchTimeline,
        failedMessage: t("workspace.header.toasts.conversationViewSwitchFailed"),
      })
        .then((releasedAgentId) => {
          onReleasedTerminal({
            tabId: findTerminalTabId(tabs, terminalId),
            terminalId,
            closeTab,
          });
          return releasedAgentId;
        })
        .finally(() => {
          releaseInFlightRef.current = null;
        });
      releaseInFlightRef.current = pending;
      return pending;
    },
    [
      client,
      fetchTimeline,
      onReleasedTerminal,
      supportsAgentConversationViewSwitch,
      supportsLegacyCodexConversationViewSwitch,
      t,
      tabs,
    ],
  );

  useEffect(() => {
    replaceLeaseBlocked(
      serverId,
      collectLeaseBlockedAgentIds(terminals, isPending ? (leftoverLinkedAgentId ?? agentId) : null),
    );
  }, [agentId, isPending, leftoverLinkedAgentId, replaceLeaseBlocked, serverId, terminals]);

  const onToggle = useCallback(async () => {
    const plan = planConversationViewSwitch({
      session: agentId ? { agentId } : null,
      leftoverTerminalId,
      focusedLinkedTerminalId,
      canOpenTerminal: Boolean(client && isConnected && workspaceDirectory),
    });
    if (plan.action === "open-terminal") {
      if (!activeTab?.tabId) {
        return;
      }
      onOpenConversationTerminal({
        agentId: plan.session.agentId,
        terminalId: plan.terminalId,
        replaceTabId: activeTab.tabId,
      });
      return;
    }
    if (plan.action !== "leave-linked-terminal") {
      return;
    }

    const sessionAgentId = focusedLinkedTerminal?.linkedAgentId ?? leftoverLinkedAgentId;
    if (!sessionAgentId) {
      return;
    }

    setIsPending(true);
    try {
      const releasedAgentId = await releaseTerminal(plan.terminalId, sessionAgentId, false);
      if (!releasedAgentId) {
        return;
      }
      onRetargetToAgent(releasedAgentId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("workspace.header.toasts.conversationViewSwitchFailed"),
      );
    } finally {
      setIsPending(false);
    }
  }, [
    activeTab?.tabId,
    agentId,
    client,
    focusedLinkedTerminal,
    focusedLinkedTerminalId,
    isConnected,
    leftoverLinkedAgentId,
    leftoverTerminalId,
    onOpenConversationTerminal,
    onRetargetToAgent,
    releaseTerminal,
    t,
    toast,
    workspaceDirectory,
  ]);

  return {
    agentId,
    chrome,
    isPending,
    onToggle,
  };
}
