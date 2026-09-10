import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { MessageCircleQuestionMark } from "lucide-react-native";

import { AgentPanelContent } from "@/panels/agent-panel";
import { usePaneContext, usePaneFocus } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { SideChatContent } from "./content";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

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
  const { serverId, workspaceId, target, openFileInWorkspace } = usePaneContext();
  const { isInteractive } = usePaneFocus();
  invariant(target.kind === "side_chat", "SideChatPanel requires side_chat target");
  const parentAgentId = target.parentAgentId;
  const renderAgent = useCallback(
    (sideAgentId: string) => (
      <AgentPanelContent
        serverId={serverId}
        workspaceId={workspaceId}
        agentId={sideAgentId}
        isPaneFocused={isInteractive}
        onOpenWorkspaceFile={openFileInWorkspace}
        showSideChat={false}
      />
    ),
    [serverId, workspaceId, isInteractive, openFileInWorkspace],
  );
  return (
    <View style={styles.container} testID="side-chat-panel">
      <SideChatContent
        serverId={serverId}
        parentAgentId={parentAgentId}
        renderAgent={renderAgent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
});

export const sideChatPanelRegistration = definePanel("side_chat", {
  component: SideChatPanel,
  useDescriptor: useSideChatPanelDescriptor,
});
