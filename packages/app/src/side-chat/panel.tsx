import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowUp, MessageCircleQuestionMark, X } from "lucide-react-native";

import { MarkdownRenderer } from "@/components/markdown/renderer";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { canOfferSideChat } from "./chrome";
import { hasPendingSideChatExchange, sideChatKey, type SideChatExchange } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

const ThemedMessageCircleQuestionMark = withUnistyles(MessageCircleQuestionMark);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedX = withUnistyles(X);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

let nextExchangeId = 0;

function createExchangeId(): string {
  nextExchangeId += 1;
  return `side-chat-${Date.now()}-${nextExchangeId}`;
}

function SideChatExchangeView({ exchange }: { exchange: SideChatExchange }) {
  const { t } = useTranslation();
  let body: ReactNode;
  if (exchange.status === "pending") {
    body = (
      <View style={styles.pendingRow}>
        <ThemedLoadingSpinner size="small" uniProps={mutedColorMapping} />
      </View>
    );
  } else if (exchange.status === "failed") {
    body = (
      <Text style={styles.errorText} selectable>
        {exchange.error ?? t("agentPanel.sideChat.noResponse")}
      </Text>
    );
  } else {
    body = (
      <View style={styles.answer}>
        {exchange.synthetic ? (
          <Text style={styles.fallbackNotice}>{t("agentPanel.sideChat.fallbackNotice")}</Text>
        ) : null}
        <MarkdownRenderer text={exchange.response ?? ""} compact />
      </View>
    );
  }
  return (
    <View style={styles.exchange}>
      <View style={styles.questionBubble}>
        <Text style={styles.questionText} selectable>
          {exchange.question}
        </Text>
      </View>
      {body}
    </View>
  );
}

export function SideChatOverlay({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const key = sideChatKey(serverId, agentId);
  const isOpen = useSideChatStore((state) => selectSideChatPanel(state, key).isOpen);
  const exchanges = useSideChatStore((state) => selectSideChatPanel(state, key).exchanges);
  const featureEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.agentSideQuestion === true,
  );
  const agent = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return session?.agents?.get(agentId) ?? session?.agentDetails?.get(agentId) ?? null;
  });
  const [draft, setDraft] = useState("");
  const inputRef = useRef<EditingTextInputHandle | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);

  const isPending = hasPendingSideChatExchange(exchanges);
  const canSend = draft.trim().length > 0 && client !== null && !isPending;

  const handleClose = useCallback(() => {
    useSideChatStore.getState().closePanel(key);
  }, [key]);

  const handleScrollToEnd = useCallback(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, []);

  const handleSend = useCallback(() => {
    const question = draft.trim();
    if (!question || !client || isPending) {
      return;
    }
    const id = createExchangeId();
    useSideChatStore.getState().beginExchange(key, { id, question });
    setDraft("");
    inputRef.current?.replaceText("");
    const ask = async () => {
      try {
        const payload = await client.askAgentSideQuestion(agentId, question);
        useSideChatStore.getState().resolveExchange(key, id, payload);
      } catch (error) {
        useSideChatStore
          .getState()
          .failExchange(key, id, error instanceof Error ? error.message : String(error));
      }
    };
    void ask();
  }, [agentId, client, draft, isPending, key]);

  if (!isOpen || !canOfferSideChat(agent, { featureEnabled })) {
    return null;
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
      <ScrollView
        ref={scrollViewRef}
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        onContentSizeChange={handleScrollToEnd}
      >
        {exchanges.length === 0 ? (
          <Text style={styles.emptyText}>{t("agentPanel.sideChat.empty")}</Text>
        ) : (
          exchanges.map((exchange) => (
            <SideChatExchangeView key={exchange.id} exchange={exchange} />
          ))
        )}
      </ScrollView>
      <View style={styles.inputRow}>
        <EditingTextInput
          ref={inputRef}
          onChangeText={setDraft}
          onSubmitEditing={handleSend}
          placeholder={t("agentPanel.sideChat.inputPlaceholder")}
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.input}
          returnKeyType="send"
          submitBehavior="submit"
          testID="agent-side-chat-input"
        />
        <Pressable
          onPress={handleSend}
          disabled={!canSend}
          style={[styles.sendButton, canSend ? null : styles.sendButtonDisabled]}
          testID="agent-side-chat-send"
          accessibilityRole="button"
          accessibilityLabel={t("agentPanel.sideChat.send")}
        >
          <ThemedArrowUp size={14} uniProps={foregroundColorMapping} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    position: "absolute",
    top: theme.spacing[3],
    right: theme.spacing[3],
    bottom: theme.spacing[3],
    width: 360,
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
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: theme.spacing[4],
    gap: theme.spacing[4],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  exchange: {
    gap: theme.spacing[2],
  },
  questionBubble: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.xl,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  questionText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  pendingRow: {
    flexDirection: "row",
    paddingVertical: theme.spacing[1],
  },
  answer: {
    gap: theme.spacing[1],
  },
  fallbackNotice: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  errorText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[3],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  input: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.lg,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  placeholderColor: {
    color: theme.colors.foregroundExtraMuted,
  },
  sendButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
}));
