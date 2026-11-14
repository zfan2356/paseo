import { isWeb } from "@/constants/platform";
import { ChangeRequestsDialog } from "@/agent-change-requests/section";
import { MATERIAL_SLOTS } from "@/styles/material-slots";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  SessionMenu,
  SessionRowMenuFrame,
  SessionArchiveButton,
  type SessionMenuActions,
} from "./menu";
import {
  sessionOperationErrorMessage,
  sessionOperationCapabilities,
  useSessionOperations,
} from "./operations";
import { useLabelMenuPages } from "@/workspace-labels/picker";
import { usePointerCapabilities } from "@/hooks/pointer-capabilities";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { useTranslation } from "react-i18next";
import { getStatusBucketLabel } from "@/hooks/sidebar-status-view-model";
import { useSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SessionContext } from "@getpaseo/protocol/session-context";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { HostBadge } from "@/hosts/host-badge";
import { SidebarCardContent } from "@/components/sidebar/sidebar-workspace-row-content";
import { ProjectStatusIndicator } from "@/components/sidebar/project-leading-visual";
import { useProjectIcons } from "@/projects/icons";
import { resolveSidebarProjectIconTargets } from "@/utils/sidebar-project-row-model";
import { density } from "@/styles/density";
import { getSidebarRowBackdrop } from "@/components/sidebar/sidebar-row-backdrop";
import type { SessionGrouping } from "./preferences";
import { sessionStatus, PINNED_SESSION_GROUP } from "./projection";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { type Agent } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSessionNavigationPreferences } from "./preferences";
import { SessionSettings } from "./actions";
import { FormTextInput } from "@/components/ui/form-field";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
export function SessionSidebar({ dismiss }: { dismiss?: () => void }) {
  const { t } = useTranslation();
  const { sessionNavigation, allProjects } = useSidebarModel();
  const view = useSessionNavigationPreferences((state) => state.grouping ?? "project");
  const setView = useSessionNavigationPreferences((state) => state.setGrouping);
  const iconTargets = useMemo(() => resolveSidebarProjectIconTargets(allProjects), [allProjects]);
  const projectIcons = useProjectIcons({ projects: iconTargets });
  const options = useMemo<SegmentedControlOption<SessionGrouping>[]>(
    () => [
      {
        value: "project",
        label: t("sessionNavigation.byProject"),
        testID: "session-group-by-project",
      },
      {
        value: "directory",
        label: t("sessionNavigation.byDirectory"),
        testID: "session-group-by-directory",
      },
    ],
    [t],
  );
  const showShortcutBadges = useShowShortcutBadges();
  const activeWorkspace = useActiveWorkspaceSelection();
  const savedSelectedKey = useSessionNavigationPreferences((state) => state.selectedSessionKey);
  const activeHost = sessionNavigation.roots.find(
    (root) => root.source.serverId === activeWorkspace?.serverId,
  );
  const focusedAgent = activeHost?.agents.find(
    (agent) =>
      agent.id === activeHost.source.focusedAgentId &&
      agent.workspaceId === activeWorkspace?.workspaceId,
  );
  const focusedKey = focusedAgent ? focusedAgent.serverId + ":" + focusedAgent.id : null;
  const selectedKey = focusedKey ?? savedSelectedKey;
  useEffect(() => {
    if (focusedKey) useSessionNavigationPreferences.getState().selectSession(focusedKey);
  }, [focusedKey]);
  const search = useSessionNavigationPreferences((state) => state.search);
  const setSearch = useSessionNavigationPreferences((state) => state.setSearch);

  return (
    <View style={styles.fill}>
      <View style={styles.viewHeader}>
        <SegmentedControl options={options} value={view} onValueChange={setView} size="sm" />
        <SidebarDisplayPreferencesMenu sessions />
      </View>
      <View style={styles.search}>
        <FormTextInput
          initialValue={search}
          onChangeText={setSearch}
          placeholder={t("sessionNavigation.search")}
          accessibilityLabel={t("sessionNavigation.search")}
        />
      </View>
      <ScrollView style={styles.fill} testID="session-sidebar" keyboardShouldPersistTaps="handled">
        {sessionNavigation.visibleHosts
          .filter(
            (host) =>
              sessionNavigation.roots.find((root) => root.source.serverId === host.serverId)?.source
                .supported === false,
          )
          .map((host) => (
            <Text key={host.serverId} style={styles.hint}>
              {t("sessionNavigation.updateHost", { host: host.label ?? host.serverId })}
            </Text>
          ))}
        {sessionNavigation.groups.map((group) => (
          <SessionGroup key={group.key} groupKey={group.key} name={group.name}>
            {group.agents.map((agent) => (
              <ProjectedSessionRow
                key={agent.serverId + ":" + agent.id}
                agent={agent}
                model={sessionNavigation}
                projects={allProjects}
                dismiss={dismiss}
                showShortcutBadges={showShortcutBadges}
                activeWorkspace={activeWorkspace}
                selectedKey={selectedKey}
                projectIcons={projectIcons}
              />
            ))}
          </SessionGroup>
        ))}
      </ScrollView>
    </View>
  );
}
function SessionGroup({
  name,
  children,
  groupKey,
}: {
  name: string;
  children: ReactNode;
  groupKey: string;
}) {
  const displayName = name;
  const pinned = groupKey === PINNED_SESSION_GROUP;
  const collapsed = useSidebarCollapsedSectionsStore((state) => {
    if (pinned) return state.collapsedPinned;
    return state.collapsedProjectKeys.has(groupKey);
  });
  const toggleGroup = useSidebarCollapsedSectionsStore((state) => {
    if (pinned) return state.togglePinnedCollapsed;
    return state.toggleProjectCollapsed;
  });
  const toggleGroupCollapsed = useCallback(() => toggleGroup(groupKey), [toggleGroup, groupKey]);
  return (
    <View testID={pinned ? "session-pinned-section" : `session-group-${groupKey}`}>
      <SidebarSectionHeader
        title={displayName}
        collapsed={collapsed}
        onToggle={toggleGroupCollapsed}
        testID={pinned ? "session-pinned-toggle" : undefined}
      />
      {collapsed ? null : children}
    </View>
  );
}
const SessionRow = memo(function SessionRow({
  agent,
  client,
  context,
  contextError,
  projects,
  dismiss,
  hostBadge,
  showLabels,
  shortcutNumber,
  selected,
  project,
  projectIcon,
  permissions,
  labelCreateSupported,
  actionsReady,
}: {
  permissions: import("@/stores/session-store").DaemonServerInfo["permissions"];
  labelCreateSupported: boolean;
  actionsReady: boolean;
  selected: boolean;
  project?: SidebarProjectEntry;
  projectIcon: string | null;
  shortcutNumber?: number;
  hostBadge?: import("@/hosts/appearance").HostBadgeModel;
  showLabels: boolean;
  agent: Agent;
  client: DaemonClient | null;
  context: SessionContext | null;
  contextError: string | null;
  projects: SidebarProjectEntry[];
  dismiss?: () => void;
}) {
  const { t } = useTranslation();
  const trailing = useSidebarWorkspaceTrailing();

  const [dialog, setDialog] = useState<"settings" | "rename" | "change-requests" | null>(null);
  const [hovered, setHovered] = useState(false);
  const connected = useHostRuntimeIsConnected(agent.serverId);
  const { finePointer } = usePointerCapabilities();
  const { mutation, assign, create, pending } = useSessionOperations(agent.serverId, agent.id);
  const { canWrite, canManage, canArchive, canRead, readOnly } = sessionOperationCapabilities({
    connected,
    permissions,
    contextReady: !!context,
    agent,
  });
  const labelTarget = useMemo(
    () =>
      context
        ? {
            serverId: agent.serverId,
            labels: context.sidebarLabelNames,
            enabled: canManage,
            createSupported: labelCreateSupported,
            assign,
            create,
          }
        : null,
    [context, agent.serverId, canManage, labelCreateSupported, assign, create],
  );
  const pages = useLabelMenuPages(labelTarget);
  const openChat = useCallback(() => {
    useSessionNavigationPreferences.getState().selectSession(`${agent.serverId}:${agent.id}`);
    navigateToAgent({ serverId: agent.serverId, agentId: agent.id });
    dismiss?.();
  }, [agent.serverId, agent.id, dismiss]);
  const openChangeRequests = useCallback(() => setDialog("change-requests"), []);
  const supportsChangeRequests = isWeb && Boolean(client?.supportsAgentChangeRequests());
  const openSettings = useCallback(() => setDialog("settings"), []);
  const archiveSession = useCallback(() => mutation.mutate({ kind: "archive" }), [mutation]);
  const renameSession = useCallback(() => setDialog("rename"), []);
  const submitRename = useCallback(
    async (name: string) => {
      try {
        await mutation.mutateAsync({ kind: "rename", name: name.trim() });
      } catch (error) {
        if (error instanceof Error)
          throw new Error(sessionOperationErrorMessage(error), { cause: error });
        throw error;
      }
    },
    [mutation],
  );
  const togglePin = useCallback(
    () => mutation.mutate({ kind: "pin", pinned: !context?.pinnedAt }),
    [mutation, context?.pinnedAt],
  );
  const markRead = useCallback(() => mutation.mutate({ kind: "read" }), [mutation]);
  const actions = useMemo<SessionMenuActions>(
    () => ({
      ready: actionsReady,
      canWrite,
      canManage,
      canArchive,
      canRead,
      pinned: !!context?.pinnedAt,
      pending,
      rename: renameSession,
      pin: togglePin,
      read: markRead,
      archive: archiveSession,
      settings: openSettings,
      linkChangeRequests: supportsChangeRequests ? openChangeRequests : undefined,
    }),
    [
      canWrite,
      canManage,
      canArchive,
      canRead,
      context,
      actionsReady,
      pending,
      renameSession,
      togglePin,
      markRead,
      archiveSession,
      openSettings,
      supportsChangeRequests,
      openChangeRequests,
    ],
  );
  const closeDialog = useCallback(() => setDialog(null), []);
  const leading = useMemo(
    () => (
      <View
        testID={`session-status-${agent.id}`}
        accessibilityRole="image"
        accessibilityLabel={getStatusBucketLabel(sessionStatus(agent), t)}
      >
        <ProjectStatusIndicator
          iconDataUri={projectIcon}
          displayName={project?.projectName ?? t("sessionNavigation.ungrouped")}
          projectViewKey={project?.viewKey ?? "ungrouped"}
          statusBucket={sessionStatus(agent)}
          backdrop={getSidebarRowBackdrop({ selected, isHovered: hovered })}
          testID={`session-project-icon-${agent.id}`}
        />
      </View>
    ),
    [agent, project, projectIcon, hovered, selected, t],
  );
  const metadata = useMemo(
    () =>
      showLabels && context?.sidebarLabelNames.length ? (
        <Text numberOfLines={1} style={styles.hint}>
          {context.sidebarLabelNames.join(", ")}
        </Text>
      ) : null,
    [showLabels, context],
  );
  const trailingContent = (
    <>
      {trailing === "timestamp" ? (
        <SessionTimestamp date={agent.lastUserMessageAt ?? agent.createdAt} />
      ) : null}
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
      {finePointer ? <SessionArchiveButton actions={actions} visible={hovered} /> : null}
      <SessionMenu actions={actions} pages={pages} />
    </>
  );
  return (
    <View testID={`session-row-${agent.id}`}>
      <SessionRowMenuFrame actions={actions} pages={pages} onHoverChange={setHovered}>
        <View
          dataSet={MATERIAL_SLOTS.sessionRow}
          style={[styles.card, hovered && styles.hovered, selected && styles.selected]}
        >
          <SidebarCardContent
            onPress={openChat}
            selected={selected}
            title={agent.title ?? t("sessionNavigation.untitled")}
            titleTestID={`session-title-${agent.id}`}
            isHovered={hovered}
            shortcutNumber={shortcutNumber}
            leading={leading}
            metadata={metadata}
            trailing={trailingContent}
          />
        </View>
      </SessionRowMenuFrame>
      <SessionActionFeedback error={mutation.error} connected={connected} readOnly={readOnly} />
      {contextError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {contextError}
        </Text>
      ) : null}
      {dialog === "rename" ? (
        <AdaptiveRenameModal
          visible
          title={t("sessionNavigation.rename")}
          initialValue={agent.title ?? ""}
          onSubmit={submitRename}
          onClose={closeDialog}
          testID="session-rename"
        />
      ) : null}
      <SessionDialog
        dialog={dialog === "rename" ? null : dialog}
        agent={agent}
        context={context}
        client={client}
        projects={projects}
        onClose={closeDialog}
      />
    </View>
  );
});
function SessionActionFeedback({
  error,
  connected,
  readOnly,
}: {
  error: Error | null;
  connected: boolean;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {sessionOperationErrorMessage(error)}
        </Text>
      ) : null}
      {!connected ? <Text style={styles.hint}>{t("sessionNavigation.offline")}</Text> : null}
      {readOnly ? <Text style={styles.hint}>{t("sessionNavigation.readOnly")}</Text> : null}
    </>
  );
}
const styles = StyleSheet.create((theme) => ({
  selected: {
    backgroundColor: theme.colors.surfaceSidebarSelected,
    borderRadius: theme.borderRadius.md,
  },
  fill: { flex: 1 },
  card: {
    paddingHorizontal: theme.spacing[2],
    minHeight: density.rowHeight,
    borderRadius: theme.borderRadius.md,
  },
  hovered: { backgroundColor: theme.colors.surfaceSidebarHover },
  viewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing[1],
  },
  search: { padding: theme.spacing[2] },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
function SessionDialog({
  dialog,
  agent,
  context,
  client,
  projects,
  onClose,
}: {
  dialog: "settings" | "change-requests" | null;
  agent: Agent;
  context: SessionContext | null;
  client: DaemonClient | null;
  projects: SidebarProjectEntry[];
  onClose(): void;
}) {
  if (!client || !context) return null;
  if (dialog === "change-requests")
    return <ChangeRequestsDialog client={client} agentId={agent.id} onClose={onClose} />;
  if (dialog === "settings")
    return (
      <SessionSettings
        client={client}
        serverId={agent.serverId}
        context={context}
        projects={projects}
        cwd={agent.cwd}
        onClose={onClose}
      />
    );
  return null;
}
function SessionTimestamp({ date }: { date: Date }) {
  const time = useCompactTimeAgo(date);
  return <Text style={styles.hint}>{time}</Text>;
}
function ProjectedSessionRow({
  agent,
  model,
  projects,
  dismiss,
  showShortcutBadges,
  activeWorkspace,
  selectedKey,
  projectIcons,
}: {
  projectIcons: ReadonlyMap<string, string | null>;
  activeWorkspace: ActiveWorkspaceSelection | null;
  selectedKey: string | null | undefined;
  showShortcutBadges: boolean;
  agent: Agent;
  model: ReturnType<typeof import("./collection").useSessionNavigationCollection>;
  projects: SidebarProjectEntry[];
  dismiss?: () => void;
}) {
  const key = agent.serverId + ":" + agent.id;
  const snapshot = model.snapshots.get(key);
  const context = snapshot?.status === "ready" ? snapshot.context : null;
  const target = model.targets.find(
    (candidate) => candidate.serverId === agent.serverId && candidate.agentId === agent.id,
  );
  const source = model.roots.find((root) => root.source.serverId === agent.serverId)?.source;
  const hostActions = source ?? {
    supported: false,
    permissions: undefined,
    labelCreateSupported: false,
  };
  const selected = Boolean(
    activeWorkspace &&
    agent.serverId === activeWorkspace.serverId &&
    agent.workspaceId === activeWorkspace.workspaceId &&
    key === selectedKey,
  );
  const project = projects.find((candidate) =>
    candidate.hosts.some(
      (host) => host.serverId === agent.serverId && host.projectId === context?.projectId,
    ),
  );
  return (
    <SessionRow
      agent={agent}
      selected={selected}
      project={project}
      projectIcon={project ? (projectIcons.get(project.viewKey) ?? null) : null}
      client={target?.client ?? null}
      context={context}
      contextError={snapshot?.status === "error" ? snapshot.message : null}
      permissions={hostActions.permissions}
      labelCreateSupported={hostActions.labelCreateSupported}
      actionsReady={hostActions.supported === false || snapshot !== undefined}
      projects={projects}
      dismiss={dismiss}
      hostBadge={model.badges.get(agent.serverId)}
      showLabels={model.rowItems.labels}
      shortcutNumber={showShortcutBadges ? model.shortcutIndexBySession.get(key) : undefined}
    />
  );
}
