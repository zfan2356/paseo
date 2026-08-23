import { useCallback, useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MessageCircleQuestionMark, X } from "lucide-react-native";

import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { useToast } from "@/contexts/toast-context";
import { closeSideChatPanel, openSideChatPanel } from "./lifecycle";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

const ThemedMessageCircleQuestionMark = withUnistyles(MessageCircleQuestionMark);
const ThemedX = withUnistyles(X);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function SideChatOverlay({
  serverId,
  agentId,
  renderAgent,
}: {
  serverId: string;
  agentId: string;
  renderAgent: (sideAgentId: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const key = sideChatKey(serverId, agentId);
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

  const handleClose = useCallback(() => {
    void closeSideChatPanel({
      key,
      serverId,
      parentAgentId: agentId,
      client,
    }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("common.errors.error"));
    });
  }, [agentId, client, key, serverId, t, toast]);

  const handleRetry = useCallback(() => {
    if (!client) return;
    void openSideChatPanel({
      key,
      serverId,
      parentAgentId: agentId,
      client,
    });
  }, [agentId, client, key, serverId]);

  if (!panel) return null;

  let content: ReactNode;
  if (panel.status === "ready") {
    content = <View style={styles.agentContent}>{renderAgent(panel.sideAgentId)}</View>;
  } else if (panel.status === "error") {
    content = (
      <View style={styles.stateContent} testID="agent-side-chat-error">
        <Text style={styles.errorText} selectable>
          {panel.error}
        </Text>
        <Button size="sm" variant="secondary" onPress={handleRetry} disabled={!client}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  } else {
    content = (
      <View style={styles.stateContent} testID="agent-side-chat-opening">
        <ThemedLoadingSpinner size="large" uniProps={mutedColorMapping} />
      </View>
    );
  }

  return (
    <View
      style={[styles.panel, isCompact ? styles.panelCompact : null]}
      testID="agent-side-chat-panel"
    >
      <View style={styles.header}>
        <ThemedMessageCircleQuestionMark size={14} uniProps={mutedColorMapping} />
        <Text style={styles.title}>{t("agentPanel.sideChat.title")}</Text>
        <Pressable
          onPress={handleClose}
          hitSlop={8}
          style={styles.closeButton}
          testID="agent-side-chat-close"
          accessibilityRole="button"
          accessibilityLabel={t("common.actions.close")}
        >
          <ThemedX size={14} uniProps={mutedColorMapping} />
        </Pressable>
      </View>
      {content}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[3],
    bottom: theme.spacing[3],
    width: 620,
    maxWidth: "90%",
    backgroundColor: theme.colors.surface1,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius["2xl"],
    overflow: "hidden",
    ...theme.shadow.lg,
  },
  panelCompact: {
    left: theme.spacing[3],
    width: "auto",
    maxWidth: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: theme.colors.border,
  },
  title: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  closeButton: {
    padding: theme.spacing[1],
  },
  agentContent: {
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
}));
