import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { WorkspaceTabDescriptor } from "@/screens/workspace/workspace-tabs-types";
import { useSessionStore } from "@/stores/session-store";
import { resolveConversationViewSwitchChrome } from "./chrome";
import {
  findFocusedLinkedConversationTerminal,
  findLinkedConversationTerminal,
  findTerminalTabId,
  shouldAutoReleaseLeftoverTerminal,
} from "./leftover";
import {
  releaseConversationTerminalOwner,
  type ConversationTerminalReleaseClient,
} from "./release";
import { canOfferConversationSurfaceSwitch, conversationSessionRefFromTabTarget } from "./session";
import { selectConversationSurface, useConversationSurfaceStore } from "./store";
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
  const agentId = canOfferConversationSurfaceSwitch(focusedAgent) ? focusedAgentId : null;
  const leftoverTerminal = findLinkedConversationTerminal(terminals, agentId);
  const leftoverTerminalId = leftoverTerminal?.id ?? null;
  const leftoverLinkedAgentId = leftoverTerminal?.linkedAgentId ?? null;
  const focusedLinkedTerminal = findFocusedLinkedConversationTerminal(
    terminals,
    activeTab?.target ?? null,
  );
  const focusedLinkedTerminalId = focusedLinkedTerminal?.id ?? null;
  const conversationSurface = useConversationSurfaceStore((state) =>
    selectConversationSurface(state, agentId),
  );
  const setConversationSurface = useConversationSurfaceStore((state) => state.setSurface);
  const pruneToAgentIds = useConversationSurfaceStore((state) => state.pruneToAgentIds);
  const markHydrated = useConversationSurfaceStore((state) => state.markHydrated);
  const surfaceHasHydrated = useConversationSurfaceStore((state) => state.hasHydrated);
  const liveAgentIdKey = useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session?.hasHydratedAgents) {
      return null;
    }
    return [...new Set([...session.agents.keys(), ...session.agentDetails.keys()])]
      .sort()
      .join("\0");
  });
  const [isPending, setIsPending] = useState(false);
  const releaseInFlightRef = useRef<Promise<string | null> | null>(null);
  const autoReleasedTerminalIdRef = useRef<string | null>(null);

  const chrome = useMemo(
    () =>
      resolveConversationViewSwitchChrome({
        agentId,
        surface: conversationSurface,
        hasLeftoverTerminal: leftoverTerminalId !== null,
        isFocusedOnLinkedTerminal: focusedLinkedTerminalId !== null,
        isPending,
        isConnected,
        hasWorkspaceDirectory: Boolean(workspaceDirectory),
      }),
    [
      agentId,
      conversationSurface,
      focusedLinkedTerminalId,
      isConnected,
      isPending,
      leftoverTerminalId,
      workspaceDirectory,
    ],
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
    if (useConversationSurfaceStore.persist.hasHydrated()) {
      markHydrated();
    }
  }, [markHydrated]);

  useEffect(() => {
    if (liveAgentIdKey == null || !surfaceHasHydrated) {
      return;
    }
    pruneToAgentIds(liveAgentIdKey.length > 0 ? liveAgentIdKey.split("\0") : []);
  }, [liveAgentIdKey, pruneToAgentIds, surfaceHasHydrated]);

  useEffect(() => {
    const shouldRelease = shouldAutoReleaseLeftoverTerminal({
      focusedAgentId: agentId,
      leftoverTerminalId,
      focusedLinkedTerminalId,
    });
    if (
      !shouldRelease ||
      !client ||
      !isConnected ||
      !leftoverTerminalId ||
      !leftoverLinkedAgentId ||
      autoReleasedTerminalIdRef.current === leftoverTerminalId
    ) {
      return;
    }
    autoReleasedTerminalIdRef.current = leftoverTerminalId;
    setIsPending(true);
    void releaseTerminal(leftoverTerminalId, leftoverLinkedAgentId, true)
      .catch((error) => {
        if (autoReleasedTerminalIdRef.current === leftoverTerminalId) {
          autoReleasedTerminalIdRef.current = null;
        }
        toast.error(
          error instanceof Error
            ? error.message
            : t("workspace.header.toasts.conversationViewSwitchFailed"),
        );
      })
      .finally(() => {
        setIsPending(false);
      });
  }, [
    agentId,
    client,
    focusedLinkedTerminalId,
    isConnected,
    leftoverLinkedAgentId,
    leftoverTerminalId,
    releaseTerminal,
    t,
    toast,
  ]);

  const onToggle = useCallback(async () => {
    const plan = planConversationViewSwitch({
      session: agentId ? { agentId } : null,
      surface: selectConversationSurface(useConversationSurfaceStore.getState(), agentId),
      leftoverTerminalId,
      focusedLinkedTerminalId,
    });
    if (plan.action === "toggle-surface") {
      setConversationSurface(plan.session.agentId, plan.nextSurface);
      return;
    }
    if (plan.action === "none") {
      return;
    }

    const sessionAgentId =
      plan.action === "release-then-toggle"
        ? plan.session.agentId
        : (focusedLinkedTerminal?.linkedAgentId ?? leftoverLinkedAgentId);
    if (!sessionAgentId) {
      return;
    }

    setIsPending(true);
    try {
      const closeTab = plan.action !== "leave-linked-terminal";
      const releasedAgentId = await releaseTerminal(plan.terminalId, sessionAgentId, closeTab);
      if (!releasedAgentId) {
        return;
      }
      if (plan.action === "release-then-toggle") {
        setConversationSurface(releasedAgentId, plan.nextSurface);
        return;
      }
      setConversationSurface(releasedAgentId, "agent");
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
    agentId,
    focusedLinkedTerminal,
    focusedLinkedTerminalId,
    leftoverLinkedAgentId,
    leftoverTerminalId,
    onRetargetToAgent,
    releaseTerminal,
    setConversationSurface,
    t,
    toast,
  ]);

  return {
    agentId,
    surface: conversationSurface,
    chrome,
    isPending,
    onToggle,
  };
}
