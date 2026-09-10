import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MessageCircleQuestionMark, X } from "lucide-react-native";

import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { useToast } from "@/contexts/toast-context";
import { closeSideChatPanel } from "./lifecycle";
import { SideChatContent } from "./content";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

const ThemedMessageCircleQuestionMark = withUnistyles(MessageCircleQuestionMark);
const ThemedX = withUnistyles(X);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Desktop docks the side chat into the Side panel as a tab; only compact form
 * factors keep this in-panel overlay.
 */
export function useSideChatOverlayEnabled(showSideChat: boolean): boolean {
  const isCompact = useIsCompactFormFactor();
  return showSideChat && isCompact;
}

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

  if (!panel) return null;

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
      <SideChatContent serverId={serverId} parentAgentId={agentId} renderAgent={renderAgent} />
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
}));
