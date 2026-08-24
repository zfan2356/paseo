import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { MessageCircleQuestionMark } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { AgentPanelContent } from "@/panels/agent-panel";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import type { PanelDescriptor, PanelRegistration } from "@/panels/panel-registry";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { openSideChatPanel } from "./lifecycle";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function useSideChatPanelDescriptor(
  target: { kind: "side_chat"; parentAgentId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const panel = useSideChatStore((state) =>
    selectSideChatPanel(state, sideChatKey(context.serverId, target.parentAgentId)),
  );
  const label = t("agentPanel.sideChat.title");
  return {
    label,
    subtitle: "",
    tooltip: label,
    titleState: panel?.status === "opening" ? "loading" : "ready",
    icon: MessageCircleQuestionMark,
    statusBucket: null,
  };
}

function SideChatPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "side_chat", "SideChatPanel requires side_chat target");
  const parentAgentId = target.parentAgentId;
  const key = sideChatKey(serverId, parentAgentId);
  const panel = useSideChatStore((state) => selectSideChatPanel(state, key));
  const client = useHostRuntimeClient(serverId);
  const visibleSideAgentId = panel?.status === "ready" ? panel.sideAgentId : null;
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );

  useEffect(() => {
    if (!viewedTimelineSync || !visibleSideAgentId) return;
    const sourceId = `side-chat:${key}`;
    viewedTimelineSync.replaceVisibleAgentIds(sourceId, [visibleSideAgentId]);
    return () => viewedTimelineSync.replaceVisibleAgentIds(sourceId, []);
  }, [key, viewedTimelineSync, visibleSideAgentId]);

  const handleReopen = useCallback(() => {
    if (!client) return;
    void openSideChatPanel({ key, serverId, parentAgentId, client });
  }, [client, key, parentAgentId, serverId]);

  if (panel?.status === "ready") {
    return (
      <View style={styles.container} testID="side-chat-panel">
        <AgentPanelContent
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={panel.sideAgentId}
          isPaneFocused={isInteractive}
          onOpenWorkspaceFile={openFileInWorkspace}
          showSideChat={false}
        />
      </View>
    );
  }

  if (panel?.status === "opening") {
    return (
      <View style={styles.stateContent} testID="side-chat-panel-opening">
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  }

  if (panel?.status === "error") {
    return (
      <View style={styles.stateContent} testID="side-chat-panel-error">
        <Text style={styles.errorText} selectable>
          {panel.error}
        </Text>
        <Button size="sm" variant="secondary" onPress={handleReopen} disabled={!client}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  }

  // No panel state: the fork was closed (or belongs to an earlier app
  // session). Reopening forks the main conversation at its current state.
  return (
    <View style={styles.stateContent} testID="side-chat-panel-closed">
      <Text style={styles.closedText}>{t("agentPanel.sideChat.closedNotice")}</Text>
      <Button size="sm" variant="secondary" onPress={handleReopen} disabled={!client}>
        {t("agentPanel.sideChat.reopen")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  stateContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
    textAlign: "center",
  },
  closedText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));

export const sideChatPanelRegistration: PanelRegistration<"side_chat"> = {
  kind: "side_chat",
  resourceKey: (target) => target.parentAgentId,
  component: SideChatPanel,
  useDescriptor: useSideChatPanelDescriptor,
};
