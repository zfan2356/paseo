import {
  useSessionDirectoryTarget,
  SessionDirectoryToolbar,
} from "@/session-navigation/directory-toolbar";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { checkoutDirectory } from "@/session-navigation/model";
import { resolveChangesPresentation } from "./changes/presentation";
import { useCallback, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { FileDiff, GitCommitHorizontal } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { PaneContentToolbar } from "@/components/ui/pane-content-toolbar";
import { isWeb, isNative } from "@/constants/platform";
import { DiffDocument } from "@/git/diff-document";
import { ChangesSurface, DiffLayoutToggle, resolveDiffLayout } from "@/git/diff-pane";
import { useCommitDiffFiles } from "@/git/use-diff-files";
import { useChangesPreferences } from "@/hooks/use-changes-preferences";
import { useAppSettings } from "@/hooks/use-settings";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import { useAddFileToChat } from "@/panels/use-add-file-to-chat";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { defaultChangesState, changesStateSchema } from "@/panels/changes/state";
import { usePanelState } from "@/panels/use-panel-state";
import { RenderProfile } from "@/utils/render-profiler";
const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedGitCommitHorizontal = withUnistyles(GitCommitHorizontal);
function useDiffPanelPreferences() {
  const { settings } = useAppSettings();
  const { preferences, updatePreferences } = useChangesPreferences();
  const isCompact = useIsCompactFormFactor();
  const canUseSplitLayout = isWeb && !isCompact;
  const effectiveLayout = resolveDiffLayout(preferences.layout, canUseSplitLayout);
  const displayPreferences = useMemo(
    () => ({
      layout: effectiveLayout,
      wrapLines: preferences.wrapLines,
      codeFontSize: settings.codeFontSize,
      monoFontFamily: settings.monoFontFamily,
    }),
    [effectiveLayout, preferences.wrapLines, settings.codeFontSize, settings.monoFontFamily],
  );
  const toggleLayout = useCallback(() => {
    void updatePreferences({ layout: preferences.layout === "unified" ? "split" : "unified" });
  }, [preferences.layout, updatePreferences]);
  const toggleWrapLines = useCallback(() => {
    void updatePreferences({ wrapLines: !preferences.wrapLines });
  }, [preferences.wrapLines, updatePreferences]);
  const toggleHideWhitespace = useCallback(() => {
    void updatePreferences({ hideWhitespace: !preferences.hideWhitespace });
  }, [preferences.hideWhitespace, updatePreferences]);
  return {
    preferences,
    isCompact,
    canUseSplitLayout,
    displayPreferences,
    toggleLayout,
    toggleWrapLines,
    toggleHideWhitespace,
  };
}
function PanelState({
  message,
  tone = "muted",
  testID,
}: {
  message: string;
  tone?: "muted" | "error";
  testID?: string;
}) {
  return (
    <View style={styles.centerState} testID={testID}>
      <Text style={tone === "error" ? styles.errorText : styles.mutedText}>{message}</Text>
    </View>
  );
}
function ChangesPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, tabId, target, openPreferredTarget, openTargetToSide } =
    usePaneContext();
  const [changesState, setChangesState] = usePanelState(changesStateSchema, defaultChangesState);
  const { preferences } = useChangesPreferences();
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  const isActive = useRetainedPanelActive();
  const selection = useSessionDirectoryTarget();
  const { directory, sessionAgentId } = selection;
  invariant(
    target.kind === "working_diff" || target.kind === "changes_tree",
    "ChangesPanel requires working_diff or changes_tree target",
  );
  const resolved = useChangesDirectory({
    serverId,
    directory: directory,
    workspaceDirectory,
  });
  const cwd = resolved.cwd;
  const { addFile, canAddToChat } = useAddFileToChat({
    serverId,
    workspaceId,
    directory: directory ? (cwd ?? undefined) : undefined,
  });
  const isTree = target.kind === "changes_tree";
  const isCompact = useIsCompactFormFactor();
  const handleOpenFile = useCallback(
    (path: string) =>
      openPreferredTarget(
        {
          kind: "file",
          path,
          directory: directory ? (cwd ?? undefined) : undefined,
          sessionAgentId: sessionAgentId,
        },
        isTree ? "diffs" : "diffFiles",
      ),
    [isTree, openPreferredTarget, directory, cwd, sessionAgentId],
  );
  const handleSelectDiffFile = useCallback(
    (path: string) =>
      openPreferredTarget(
        {
          kind: "working_diff",
          directory: directory,
          sessionAgentId: sessionAgentId,
          focusPath: path,
          focusRequestId: Date.now(),
        },
        "diffs",
      ),
    [openPreferredTarget, directory, sessionAgentId],
  );
  const handleOpenDiffToSide = useCallback(
    (path: string) =>
      openTargetToSide?.({
        kind: "working_diff",
        directory: directory,
        sessionAgentId: sessionAgentId,
        focusPath: path,
        focusRequestId: Date.now(),
      }),
    [openTargetToSide, directory, sessionAgentId],
  );
  if (resolved.loading)
    return (
      <View style={styles.container}>
        <SessionDirectoryToolbar selection={selection} />
        <PanelState message={t("common.loading")} />
      </View>
    );
  if (resolved.error)
    return (
      <View style={styles.container}>
        <SessionDirectoryToolbar selection={selection} />
        <PanelState message={resolved.error} tone="error" />
      </View>
    );
  if (!cwd) {
    return <PanelState message={t("panels.diff.directoryMissing")} />;
  }
  const presentation = resolveChangesPresentation({
    isTree,
    inlineDiff: preferences.inlineDiff,
    isCompact,
    isNative,
  });
  const testID = isTree ? "changes-tree-panel" : "working-diff-panel";
  const profileId = isTree ? `ChangesTreePanel:${tabId}` : `WorkingDiffPanel:${tabId}`;
  return (
    <View style={styles.container} testID={testID}>
      <SessionDirectoryToolbar selection={selection} />
      {directory ? (
        <View>
          <Text selectable style={styles.mutedText}>
            {directory}
          </Text>
          <Text selectable style={styles.mutedText}>
            {t("sessionNavigation.checkoutRoot", { path: cwd })}
          </Text>
          <Text style={styles.mutedText}>{t("sessionNavigation.changesHint")}</Text>
        </View>
      ) : null}
      <RenderProfile id={profileId}>
        <ChangesSurface
          serverId={serverId}
          workspaceId={workspaceId}
          cwd={cwd}
          directory={directory}
          sessionAgentId={sessionAgentId}
          enabled={isActive}
          presentation={presentation}
          focusPath={target.kind === "working_diff" ? target.focusPath : undefined}
          focusRequestId={target.kind === "working_diff" ? target.focusRequestId : undefined}
          onSelectDiffFile={isTree ? handleSelectDiffFile : undefined}
          onOpenFile={handleOpenFile}
          onOpenToSide={isTree && openTargetToSide ? handleOpenDiffToSide : undefined}
          onAddToChat={canAddToChat ? addFile : undefined}
          state={changesState}
          onStateChange={setChangesState}
        />
      </RenderProfile>
    </View>
  );
}
function CommitDiffPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  const panelPreferences = useDiffPanelPreferences();
  invariant(target.kind === "commit_diff", "CommitDiffPanel requires commit_diff target");
  const cwd = target.directory ?? workspaceDirectory;
  const { files, isLoading, error, capabilityMissing } = useCommitDiffFiles({
    serverId,
    cwd: cwd ?? "",
    sha: target.sha,
    enabled: Boolean(cwd),
  });
  const mode = useMemo(() => ({ kind: "commit" as const }), []);
  let body: ReactNode;
  if (!cwd) {
    body = <PanelState message={t("panels.diff.directoryMissing")} />;
  } else if (capabilityMissing) {
    body = (
      <PanelState
        message={t("panels.diff.capabilityMissing")}
        testID="commit-diff-capability-missing"
      />
    );
  } else if (error) {
    body = (
      <PanelState message={t("panels.diff.loadError")} tone="error" testID="commit-diff-error" />
    );
  } else if (isLoading && files.length === 0) {
    body = <PanelState message={t("workspace.tabs.loading")} testID="commit-diff-loading" />;
  } else if (files.length === 0) {
    body = <PanelState message={t("panels.diff.empty")} testID="commit-diff-empty" />;
  } else {
    body = (
      <DiffDocument
        files={files}
        displayPreferences={panelPreferences.displayPreferences}
        mode={mode}
      />
    );
  }
  return (
    <View style={styles.container} testID="commit-diff-panel">
      {panelPreferences.canUseSplitLayout ? (
        <PaneContentToolbar style={styles.toolbar} testID="commit-diff-header">
          <View style={styles.toolbarActions} testID="commit-diff-toolbar">
            <DiffLayoutToggle
              layout={panelPreferences.preferences.layout}
              isMobile={panelPreferences.isCompact}
              testID="commit-diff-toggle-layout"
              onToggle={panelPreferences.toggleLayout}
            />
          </View>
        </PaneContentToolbar>
      ) : null}
      <View style={styles.body}>{body}</View>
    </View>
  );
}
const workingDiffPresentation = {
  label: (t) => t("panels.diff.diffLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: ThemedFileDiff,
} satisfies PanelPresentation;
const changesTreePresentation = {
  label: (t) => t("panels.diff.changesLabel"),
  subtitle: (t) => t("panels.diff.changesSubtitle"),
  tooltip: (t) => t("panels.diff.changesSubtitle"),
  icon: ThemedFileDiff,
} satisfies PanelPresentation;
function useCommitDiffPanelDescriptor(
  target: Extract<
    WorkspaceTabTarget,
    {
      kind: "commit_diff";
    }
  >,
): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: target.sha.slice(0, 7),
    subtitle: t("panels.diff.commitSubtitle"),
    tooltip: target.sha,
    titleState: "ready",
    icon: ThemedGitCommitHorizontal,
    statusBucket: null,
  };
}
export const workingDiffPanelRegistration = definePanel("working_diff", {
  component: ChangesPanel,
  presentation: workingDiffPresentation,
});
export const changesTreePanelRegistration = definePanel("changes_tree", {
  component: ChangesPanel,
  presentation: changesTreePresentation,
});
export const commitDiffPanelRegistration = definePanel("commit_diff", {
  component: CommitDiffPanel,
  useDescriptor: useCommitDiffPanelDescriptor,
});
const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[2],
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[1],
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[16],
  },
  mutedText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  errorText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.destructive,
    textAlign: "center",
  },
}));
function useChangesDirectory({
  serverId,
  directory,
  workspaceDirectory,
}: {
  serverId: string;
  directory?: string;
  workspaceDirectory: string | null | undefined;
}) {
  const candidate = directory ?? workspaceDirectory;
  const query = useCheckoutStatusQuery({ serverId, cwd: candidate ?? "" });
  const cwd =
    directory && candidate
      ? checkoutDirectory({ directory: candidate, status: query.status })
      : candidate;
  return {
    cwd,
    loading: directory !== undefined && query.isLoading,
    error: query.error?.message ?? null,
  };
}
