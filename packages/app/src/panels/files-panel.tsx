import {
  useSessionDirectoryTarget,
  SessionDirectoryToolbar,
} from "@/session-navigation/directory-toolbar";
import { Text, View } from "react-native";
import { Files } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { FileExplorerPane } from "@/components/file-explorer-pane";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";

const ThemedFiles = withUnistyles(Files);
const filesPanelPresentation = {
  label: (t) => t("panels.files.label"),
  subtitle: (t) => t("panels.files.subtitle"),
  tooltip: (t) => t("panels.files.tooltip"),
  icon: ThemedFiles,
} satisfies PanelPresentation;

function FilesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target, openPreferredTarget, openTargetToSide } = usePaneContext();
  const defaultRoot = useWorkspaceDirectory(serverId, workspaceId);
  const selection = useSessionDirectoryTarget();
  const { directory, sessionAgentId } = selection;
  const { addFile, canAddToChat } = useAddFileToChat({ serverId, workspaceId, directory });
  invariant(target.kind === "files", "FilesPanel requires files target");
  const workspaceRoot = directory ?? defaultRoot;
  const onOpenFile = useCallback(
    (path: string) =>
      openPreferredTarget(
        { kind: "file", path, directory: directory, sessionAgentId },
        "explorerFiles",
      ),
    [openPreferredTarget, directory, sessionAgentId],
  );
  const onOpenFileToSide = useCallback(
    (path: string) =>
      openTargetToSide?.({
        kind: "file",
        path,
        directory: directory,
        sessionAgentId: sessionAgentId,
      }),
    [openTargetToSide, directory, sessionAgentId],
  );
  if (!workspaceRoot) {
    return (
      <View style={styles.centerState}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <SessionDirectoryToolbar selection={selection} />
      {directory ? (
        <Text selectable style={styles.path}>
          {serverId} · {directory}
        </Text>
      ) : null}
      <FileExplorerPane
        serverId={serverId}
        workspaceId={workspaceId}
        sessionAgentId={sessionAgentId}
        workspaceRoot={workspaceRoot}
        onOpenFile={onOpenFile}
        onOpenFileToSide={openTargetToSide ? onOpenFileToSide : undefined}
        onAddToChat={canAddToChat ? addFile : undefined}
      />
    </View>
  );
}

export const filesPanelRegistration = definePanel("files", {
  component: FilesPanel,
  presentation: filesPanelPresentation,
});

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  path: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
}));
