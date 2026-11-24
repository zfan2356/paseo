import { useCallback, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { SideChatHistory } from "./history";
import { openSideChatPanel, showSideChatHistory } from "./lifecycle";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function SideChatContent({
  serverId,
  parentAgentId,
  renderAgent,
}: {
  serverId: string;
  parentAgentId: string;
  renderAgent: (sideAgentId: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const key = sideChatKey(serverId, parentAgentId);
  const panel = useSideChatStore((state) => selectSideChatPanel(state, key));
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
  const back = useCallback(() => showSideChatHistory(key), [key]);
  const retrySideAgentId = panel?.status === "error" ? panel.sideAgentId : undefined;
  const retry = useCallback(() => {
    if (!client || !retrySideAgentId) return;
    void openSideChatPanel({ key, serverId, parentAgentId, sideAgentId: retrySideAgentId, client });
  }, [client, key, serverId, parentAgentId, retrySideAgentId]);

  if (!panel || panel.status === "history") {
    return <SideChatHistory key={key} serverId={serverId} parentAgentId={parentAgentId} />;
  }
  let content: ReactNode;
  if (panel.status === "ready") {
    content = renderAgent(panel.sideAgentId);
  } else if (panel.status === "opening") {
    content = (
      <View style={styles.stateContent} testID="side-chat-panel-opening">
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  } else {
    content = (
      <View style={styles.stateContent} testID="side-chat-panel-error">
        <Text style={styles.errorText} selectable>
          {panel.error}
        </Text>
        {retrySideAgentId ? (
          <Button size="sm" variant="secondary" disabled={!client || !isConnected} onPress={retry}>
            {t("common.actions.retry")}
          </Button>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Button size="sm" variant="ghost" onPress={back} testID="side-chat-back">
          {t("agentPanel.sideChat.backToHistory")}
        </Button>
      </View>
      {content}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  toolbar: {
    alignItems: "flex-start",
    padding: theme.spacing[2],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  stateContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[6],
  },
  errorText: { fontSize: theme.fontSize.sm, color: theme.colors.statusDanger, textAlign: "center" },
}));
