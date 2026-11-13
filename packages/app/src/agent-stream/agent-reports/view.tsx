import { memo, useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react-native";
import { ExpandableBadge, TurnCopyButton } from "@/components/message";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { MessageSender } from "@/components/user-message";
import { useSessionStore } from "@/stores/session-store";
import { useToolCallExpanded } from "@/tool-calls/expansion-context";
import { useChatFindSelectedMessageId } from "../chat-find";
import type { AgentReport } from "./model";
import { useDisclosureHold } from "../disclosure";

interface AgentReportViewProps {
  itemId: string;
  report: AgentReport;
  serverId: string;
}

const MESSAGE_TEXT_DATASET = { messageText: "true" };

export const AgentReportView = memo(function AgentReportView({
  itemId,
  report,
  serverId,
}: AgentReportViewProps) {
  const { t } = useTranslation();
  const hold = useDisclosureHold();
  const sender = report.entries[0]!.message.sender;
  const host = sender.serverId ?? serverId;
  const title = useSessionStore((state) => {
    const session = state.sessions[host];
    return session?.agents.get(sender.id)?.title ?? session?.agentDetails.get(sender.id)?.title;
  });
  const { expanded, toggle } = useToolCallExpanded({
    callId: itemId,
    defaultExpanded: false,
    standalone: true,
  });
  const selectedId = useChatFindSelectedMessageId();
  const isSearchResult = report.entries.some((entry) => entry.id === selectedId);
  const finished = report.entries.some((entry) => entry.message.event === "finished");
  const label = t("agentReport.received", { name: title ?? sender.title ?? sender.id });
  const secondaryLabel = finished ? t("agentReport.finished") : undefined;
  const entries = useMemo(
    () =>
      report.entries.map((entry) => ({
        ...entry,
        dataSet: entry.id === itemId ? undefined : { messageId: entry.id },
      })),
    [report, itemId],
  );
  const getContent = useCallback(
    () => report.entries.map((entry) => entry.message.text).join("\n\n"),
    [report],
  );
  const handleToggle = useCallback(() => {
    hold(toggle);
  }, [hold, toggle]);
  const renderDetails = useCallback(
    () => (
      <View style={styles.details} testID="agent-report-details">
        <View style={styles.actions}>
          <View style={styles.sender}>
            <MessageSender sender={sender} serverId={serverId} />
          </View>
          <TurnCopyButton getContent={getContent} accessibilityLabel={t("agentReport.copy")} />
        </View>
        {entries.map((entry) => (
          <View key={entry.id} dataSet={entry.dataSet} style={styles.entry}>
            {entry.message.event === "finished" ? (
              <Text style={styles.event}>{t("agentReport.completion")}</Text>
            ) : null}
            <View dataSet={MESSAGE_TEXT_DATASET}>
              <MarkdownRenderer text={entry.message.text} />
            </View>
          </View>
        ))}
      </View>
    ),
    [entries, sender, serverId, getContent, t],
  );
  return (
    <ExpandableBadge
      testID="agent-report"
      label={label}
      secondaryLabel={secondaryLabel}
      icon={MessageSquare}
      isExpanded={expanded || isSearchResult}
      onToggle={handleToggle}
      renderDetails={renderDetails}
    />
  );
});

const styles = StyleSheet.create((theme) => ({
  details: { padding: theme.spacing[3], gap: theme.spacing[3] },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sender: { flexShrink: 1, minWidth: 0 },
  entry: { gap: theme.spacing[2] },
  event: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
