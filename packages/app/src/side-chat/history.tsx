import { useCallback, type ReactNode } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { openSideChatPanel } from "./lifecycle";
import { sideChatKey } from "./model";

type SideChatEntry = NonNullable<
  Awaited<ReturnType<DaemonClient["listAgentSideChats"]>>["sideChats"]
>[number];

function SideChatHistoryRow({
  chat,
  disabled,
  onOpen,
}: {
  chat: SideChatEntry;
  disabled: boolean;
  onOpen: (sideAgentId: string) => void;
}) {
  const handleOpen = useCallback(() => onOpen(chat.sideAgentId), [onOpen, chat.sideAgentId]);
  return (
    <Pressable
      style={styles.row}
      onPress={handleOpen}
      disabled={disabled}
      accessibilityRole="button"
      testID={`side-chat-history-${chat.sideAgentId}`}
    >
      <Text style={styles.heading} numberOfLines={2}>
        {chat.title}
      </Text>
      <Text style={styles.metadata}>{new Date(chat.updatedAt).toLocaleString()}</Text>
      <Text style={styles.metadata} numberOfLines={1}>
        {chat.sideAgentId}
      </Text>
    </Pressable>
  );
}

export function SideChatHistory({
  serverId,
  parentAgentId,
}: {
  serverId: string;
  parentAgentId: string;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSideChatHistory === true,
  );
  const enabled = !!client && isConnected && supported;
  const history = useFetchQuery({
    queryKey: ["side-chat-history", serverId, parentAgentId],
    enabled,
    dataShape: "list",
    staleTimeMs: 0,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientDisconnected"));
      const result = await client.listAgentSideChats(parentAgentId);
      if (result.error) throw new Error(result.error);
      return result.sideChats ?? [];
    },
  });
  const open = useCallback(
    (sideAgentId?: string) => {
      if (!client || !enabled) return;
      void openSideChatPanel({
        key: sideChatKey(serverId, parentAgentId),
        serverId,
        parentAgentId,
        sideAgentId,
        client,
      });
    },
    [client, enabled, serverId, parentAgentId],
  );
  const create = useCallback(() => open(), [open]);
  const { refetch } = history;
  const retry = useCallback(() => void refetch(), [refetch]);
  let notice: ReactNode = null;
  if (!isConnected) {
    notice = <Text style={styles.notice}>{t("agentPanel.states.reconnecting")}</Text>;
  } else if (!supported) {
    notice = <Text style={styles.notice}>{t("agentPanel.sideChat.upgradeRequired")}</Text>;
  } else if (history.isError) {
    notice = (
      <View style={styles.header}>
        <Text style={styles.error} selectable>
          {history.error.message}
        </Text>
        <Button size="sm" variant="secondary" onPress={retry}>
          {t("common.actions.retry")}
        </Button>
      </View>
    );
  } else if (history.isPending) {
    notice = <Text style={styles.notice}>{t("common.loading")}</Text>;
  } else if (history.data.length === 0) {
    notice = <Text style={styles.notice}>{t("agentPanel.sideChat.emptyHistory")}</Text>;
  }
  return (
    <View style={styles.container} testID="side-chat-history">
      <View style={styles.header}>
        <Text style={styles.heading}>{t("agentPanel.sideChat.history")}</Text>
        <Button
          size="sm"
          variant="secondary"
          onPress={create}
          disabled={!enabled}
          testID="side-chat-new"
        >
          {t("agentPanel.sideChat.newConversation")}
        </Button>
      </View>
      {notice}
      <ScrollView contentContainerStyle={styles.list}>
        {history.data?.map((chat) => (
          <SideChatHistoryRow
            key={chat.sideAgentId}
            chat={chat}
            disabled={!enabled}
            onOpen={open}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  heading: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
  },
  notice: {
    padding: theme.spacing[4],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  error: { flex: 1, fontSize: theme.fontSize.sm, color: theme.colors.statusDanger },
  list: { padding: theme.spacing[3], gap: theme.spacing[2] },
  row: {
    padding: theme.spacing[3],
    gap: theme.spacing[2],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
  },
  metadata: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
