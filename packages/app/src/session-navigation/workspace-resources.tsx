import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useImportSession } from "@/hooks/use-import-session";
import { usePanelStore } from "@/stores/panel-store";
import { View } from "react-native";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanelsTopLeft } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, FULL_SHEET_SNAP_POINTS } from "@/components/adaptive-modal-sheet";
import { SidebarModelProvider, useSidebarModel } from "@/components/sidebar/sidebar-model";
import { SidebarWorkspaceList } from "@/components/sidebar-workspace-list";
import { Button } from "@/components/ui/button";
import { useIsCompactFormFactor } from "@/constants/layout";

const ResourceIcon = withUnistyles(PanelsTopLeft);
const iconProps = (theme: import("@/styles/theme").Theme) => ({
  color: theme.colors.foregroundMuted,
});
const EMPTY_SHORTCUTS = new Map<string, number>();

export function WorkspaceResourcesButton() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const [visible, setVisible] = useState(false);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onPress={open}
        accessibilityLabel={t("sessionNavigation.workspaceResources")}
        testID="workspace-resources-open"
      >
        {compact ? (
          <ResourceIcon size={18} uniProps={iconProps} />
        ) : (
          t("sessionNavigation.workspaceResources")
        )}
      </Button>
      {visible ? <WorkspaceResourcesSheet onClose={close} /> : null}
    </>
  );
}

export function WorkspaceResourcesSheet({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const header = useMemo(() => ({ title: t("sessionNavigation.workspaceResources") }), [t]);
  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      snapPoints={FULL_SHEET_SNAP_POINTS}
      scrollable={false}
      bodyStyle={styles.body}
      testID="workspace-resources-sheet"
    >
      <SidebarModelProvider active>
        <WorkspaceResourceList onClose={onClose} />
      </SidebarModelProvider>
    </AdaptiveModalSheet>
  );
}

function WorkspaceResourceList({ onClose }: { onClose(): void }) {
  const model = useSidebarModel();
  const openProject = useOpenAddProject();
  const addProject = useCallback(() => openProject(), [openProject]);
  const importSession = useImportSession();
  const openWorkspace = useCallback(() => {
    usePanelStore.getState().showMobileAgent();
    onClose();
  }, [onClose]);
  return (
    <View style={styles.fill} testID="workspace-resource-list">
      <View style={styles.preferences}>
        <SidebarDisplayPreferencesMenu />
      </View>
      <SidebarWorkspaceList
        collapsedProjectKeys={model.collapsedProjectKeys}
        onToggleProjectCollapsed={model.toggleProjectCollapsed}
        shortcutIndexByWorkspaceKey={EMPTY_SHORTCUTS}
        groupMode={model.groupMode}
        workspaceGroups={model.workspaceGroups}
        projectIconTargets={model.projectIconTargets}
        pinnedGroups={model.pinnedGroups}
        projects={model.projects}
        hasProjectsBeforeFilter={model.hasProjectsBeforeFilter}
        hasActiveProjectFilter={model.resolvedProjectFilters.length > 0}
        workspaceEntriesByKey={model.workspaceEntriesByKey}
        onWorkspacePress={openWorkspace}
        onAddProject={addProject}
        onImportSession={importSession.open}
      />
      {importSession.sheet}
    </View>
  );
}
const styles = StyleSheet.create({
  body: { height: 520, flexShrink: 1 },
  fill: { flex: 1 },
  preferences: { alignItems: "flex-end" },
});
