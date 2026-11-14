import {
  useWorkspaceLayoutStore,
  selectExplorerSidebarPaneId,
} from "@/stores/workspace-layout-store";
import { findPaneById, collectAllTabs } from "@/stores/workspace-layout-actions";
import { useIsExplorerSidebarOpen } from "@/workspace-tabs/explorer-sidebar";
import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { useTranslation } from "react-i18next";
import { getStatusBucketLabel, STATUS_BUCKET_ORDER } from "@/hooks/sidebar-status-view-model";
import { useSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { Fragment, memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Text, View, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import { useFetchQueries } from "@/data/query";
import type { SessionContext } from "@getpaseo/protocol/session-context";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { HostBadge } from "@/hosts/host-badge";
import { AgentStatusDot } from "@/components/agent-status-dot";
import { sessionStatus, PINNED_SESSION_GROUP } from "./projection";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { type Agent } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useSessionNavigationPreferences } from "./preferences";
import { readDirectoryFacts, sessionDirectories, groupDirectories } from "./model";
import {
  BindDirectory,
  SessionSettings,
  CreateSessionWorktree,
  useContextMutation,
} from "./actions";
import { Button } from "@/components/ui/button";
import { PressHighlight } from "@/components/ui/press-highlight";
import { FormTextInput } from "@/components/ui/form-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
  type ActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { checkoutStatusQueryKey } from "@/git/query-keys";
import { shortenPath } from "@/utils/shorten-path";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
export function SessionSidebar({
  children,
  dismiss,
}: {
  children: ReactNode;
  dismiss?: () => void;
}) {
  const { t } = useTranslation();
  const { sessionNavigation, allProjects } = useSidebarModel();
  const [view, setView] = useState<"sessions" | "resources">("sessions");
  const resources = view === "resources";
  const options = useMemo<SegmentedControlOption<"sessions" | "resources">[]>(
    () => [
      {
        value: "sessions",
        label: t("sessionNavigation.sessions"),
        testID: "session-navigation-sessions",
      },
      {
        value: "resources",
        label: t("sessionNavigation.resources"),
        testID: "directory-terminal-resources",
      },
    ],
    [t],
  );
  const showShortcutBadges = useShowShortcutBadges();
  const activeWorkspace = useActiveWorkspaceSelection();
  const activeWorkspaceKey = activeWorkspace
    ? `${activeWorkspace.serverId}:${activeWorkspace.workspaceId}`
    : null;
  const compact = useIsCompactFormFactor();
  const explorerOpen = useIsExplorerSidebarOpen({
    isCompact: compact,
    workspaceKey: activeWorkspaceKey,
  });
  const explorerTarget = useWorkspaceLayoutStore((state) => {
    if (!activeWorkspaceKey) return null;
    const layout = state.layoutByWorkspace[activeWorkspaceKey];
    if (!layout) return null;
    const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, activeWorkspaceKey));
    return (
      collectAllTabs(layout.root).find((tab) => tab.tabId === pane?.focusedTabId)?.target ?? null
    );
  });
  const directoryTarget =
    explorerOpen && explorerTarget && "directory" in explorerTarget ? explorerTarget : null;
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
        <SidebarDisplayPreferencesMenu sessions={!resources} />
      </View>
      {resources ? (
        <View style={styles.resources} testID="directory-terminal-resource-list">
          {children}
        </View>
      ) : (
        <>
          <View style={styles.search}>
            <FormTextInput
              initialValue={search}
              onChangeText={setSearch}
              placeholder={t("sessionNavigation.search")}
              accessibilityLabel={t("sessionNavigation.search")}
            />
          </View>
          <ScrollView
            style={styles.fill}
            testID="session-sidebar"
            keyboardShouldPersistTaps="handled"
          >
            {sessionNavigation.visibleHosts
              .filter(
                (host) =>
                  sessionNavigation.roots.find((root) => root.source.serverId === host.serverId)
                    ?.source.supported === false,
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
                    directoryTarget={directoryTarget}
                  />
                ))}
              </SessionGroup>
            ))}
          </ScrollView>
        </>
      )}
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
  const { t } = useTranslation();
  const bucket = STATUS_BUCKET_ORDER.find((candidate) => candidate === groupKey);
  const displayName = bucket ? getStatusBucketLabel(bucket, t) : name;
  const mode = useSidebarModel().groupMode;
  const pinned = groupKey === PINNED_SESSION_GROUP;
  const collapsed = useSidebarCollapsedSectionsStore((state) => {
    if (pinned) return state.collapsedPinned;
    if (mode === "status") return state.collapsedWorkspaceGroupKeys.has(groupKey);
    return state.collapsedProjectKeys.has(groupKey);
  });
  const toggleGroup = useSidebarCollapsedSectionsStore((state) => {
    if (pinned) return state.togglePinnedCollapsed;
    if (mode === "status") return state.toggleWorkspaceGroupCollapsed;
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
  supported,
  projects,
  dismiss,
  hostBadge,
  showLabels,
  projectLabel,
  shortcutNumber,
  selected,
  activeDirectoryPath,
}: {
  selected: boolean;
  activeDirectoryPath?: string;
  shortcutNumber?: number;
  projectLabel?: string;
  hostBadge?: import("@/hosts/appearance").HostBadgeModel;
  showLabels: boolean;
  agent: Agent;
  client: DaemonClient | null;
  context: SessionContext | null;
  contextError: string | null;
  supported: boolean;
  projects: SidebarProjectEntry[];
  dismiss?: () => void;
}) {
  const { t } = useTranslation();
  const trailing = useSidebarWorkspaceTrailing();
  const rowStyle = useMemo(() => [styles.row, selected && styles.selected], [selected]);
  const selectedState = useMemo(() => ({ selected }), [selected]);
  const key = `${agent.serverId}:${agent.id}`;
  const expanded = useSessionNavigationPreferences((state) => state.expanded[key] === true);
  const toggle = useSessionNavigationPreferences((state) => state.toggleExpanded);
  const [dialog, setDialog] = useState<"settings" | "bind" | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error(t("sessionNavigation.offline"));
      return client.archiveAgent(agent.id);
    },
  });
  const openChat = useCallback(() => {
    useSessionNavigationPreferences.getState().selectSession(`${agent.serverId}:${agent.id}`);
    navigateToAgent({ serverId: agent.serverId, agentId: agent.id });
    dismiss?.();
  }, [agent.serverId, agent.id, dismiss]);
  const toggleSessionExpanded = useCallback(() => toggle(key), [toggle, key]);
  const openSettings = useCallback(() => setDialog("settings"), []);
  const openBindDirectory = useCallback(() => setDialog("bind"), []);
  const archiveSession = useCallback(() => archive.mutate(), [archive]);
  const closeDialog = useCallback(() => setDialog(null), []);
  return (
    <View testID={`session-row-${agent.id}`}>
      <View style={rowStyle}>
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel={t(
            expanded ? "sessionNavigation.collapse" : "sessionNavigation.expand",
          )}
          onPress={toggleSessionExpanded}
          disabled={!supported}
        >
          {expanded ? "▾" : "▸"}
        </Button>
        <PressHighlight
          style={styles.title}
          onPress={openChat}
          accessibilityRole="button"
          accessibilityState={selectedState}
          aria-selected={selected}
        >
          <View style={styles.titleLine}>
            <View
              testID={`session-status-${agent.id}`}
              accessibilityRole="image"
              accessibilityLabel={getStatusBucketLabel(sessionStatus(agent), t)}
            >
              <AgentStatusDot bucket={sessionStatus(agent)} showInactive />
            </View>
            <Text numberOfLines={1} style={styles.text}>
              {agent.title ?? t("sessionNavigation.untitled")}
            </Text>
          </View>
          <SessionMetadata
            agent={agent}
            context={context}
            hostBadge={hostBadge}
            showLabels={showLabels}
            projectLabel={projectLabel}
          />
        </PressHighlight>
        {shortcutNumber ? <Text style={styles.hint}>{shortcutNumber}</Text> : null}
        {trailing === "timestamp" ? (
          <SessionTimestamp date={agent.lastUserMessageAt ?? agent.createdAt} />
        ) : null}
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={t("sessionNavigation.sessionMenu")}
          >
            <Text style={styles.menu}>⋯</Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={t("sessionNavigation.session")}>
            <DropdownMenuItem disabled={!context || !client} onSelect={openSettings}>
              {t("sessionNavigation.settings")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!context || !client} onSelect={openBindDirectory}>
              {t("sessionNavigation.bind")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={archive.isPending} onSelect={archiveSession}>
              {t("sessionNavigation.archive")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {archive.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {archive.error.message}
        </Text>
      ) : null}
      {contextError ? (
        <Text style={styles.error} accessibilityRole="alert">
          {contextError}
        </Text>
      ) : null}
      {supported && expanded && !context ? (
        <Text style={styles.hint}>{t("sessionNavigation.loading")}</Text>
      ) : null}
      {expanded && context && client ? (
        <SessionDirectories
          agent={agent}
          client={client}
          context={context}
          dismiss={dismiss}
          activeDirectoryPath={activeDirectoryPath}
          bind={openBindDirectory}
        />
      ) : null}
      <SessionDialog
        dialog={dialog}
        agent={agent}
        context={context}
        client={client}
        projects={projects}
        onClose={closeDialog}
      />
    </View>
  );
});
function SessionDirectories({
  agent,
  client,
  context,
  dismiss,
  bind,
  activeDirectoryPath,
}: {
  activeDirectoryPath?: string;
  agent: Agent;
  client: DaemonClient;
  context: SessionContext;
  dismiss?: () => void;
  bind(): void;
}) {
  const { t } = useTranslation();
  const connected = useHostRuntimeIsConnected(agent.serverId);

  const active = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  const mutation = useContextMutation(client, agent.serverId, agent.id);
  const [worktreeRepository, setWorktreeRepository] = useState<string | null>(null);
  const directories = sessionDirectories(context);
  const facts = useFetchQueries(
    directories.map((directory) => ({
      queryKey: checkoutStatusQueryKey(agent.serverId, directory.path),
      queryFn: () =>
        readDirectoryFacts({
          client,
          path: directory.path,
          refreshError: t("sessionNavigation.refreshError"),
        }),
      enabled: connected && active,
      dataShape: "value",
      staleTimeMs: 15000,
      retry: false,
    })),
  );
  const groups = groupDirectories(
    directories.map((directory, index) => {
      const query = facts[index];
      const status = query.data;
      const repository = status?.isGit ? (status.mainRepoRoot ?? status.repoRoot) : null;
      return { path: directory.path, launch: directory.launch, repository, status, query };
    }),
  );
  const open = useCallback(
    (path: string, kind: "files" | "changes_tree") => {
      if (!agent.workspaceId) return;
      dismiss?.();
      useSessionNavigationPreferences
        .getState()
        .selectDirectory(`${agent.serverId}:${agent.id}`, path);
      navigateToAgent({ serverId: agent.serverId, agentId: agent.id });
      navigateToWorkspace({
        serverId: agent.serverId,
        workspaceId: agent.workspaceId,
        target: { kind, directory: path, sessionAgentId: agent.id },
      });
      if (compact) usePanelStore.getState().showMobileFileExplorer();
    },
    [agent.workspaceId, agent.serverId, agent.id, compact, dismiss],
  );
  const closeWorktreeDialog = useCallback(() => setWorktreeRepository(null), []);
  return (
    <View style={styles.directories}>
      {mutation.error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {mutation.error.message}
        </Text>
      ) : null}
      {groups.map((group) => {
        return (
          <Fragment key={group.repository ?? "other"}>
            <Text style={styles.hint}>
              {group.repository
                ? shortenPath(group.repository)
                : t("sessionNavigation.otherDirectories")}
            </Text>
            {group.directories.map((directory) => (
              <DirectoryRow
                key={directory.path}
                directory={directory}
                selected={activeDirectoryPath === directory.path}
                connected={connected}
                agentId={agent.id}
                open={open}
                mutation={mutation}
              />
            ))}
            {group.repository ? (
              <WorktreeButton repository={group.repository} select={setWorktreeRepository} />
            ) : null}
          </Fragment>
        );
      })}
      <Button variant="ghost" size="sm" onPress={bind}>
        {t("sessionNavigation.addDirectory")}
      </Button>
      {mutation.isPending ? (
        <Text style={styles.hint}>{t("sessionNavigation.updating")}</Text>
      ) : null}
      {worktreeRepository ? (
        <CreateSessionWorktree
          client={client}
          serverId={agent.serverId}
          agentId={agent.id}
          repository={worktreeRepository}
          onClose={closeWorktreeDialog}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  selected: {
    backgroundColor: theme.colors.interactionHighlight,
    borderRadius: theme.borderRadius.md,
  },
  fill: { flex: 1 },
  resources: { flex: 1 },
  viewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: theme.spacing[1],
  },
  search: { padding: theme.spacing[2] },
  host: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
  },
  title: { flex: 1, minWidth: 0, paddingVertical: theme.spacing[1] },
  titleLine: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base, flexShrink: 1 },
  hint: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  menu: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    padding: theme.spacing[2],
  },
  directories: { paddingLeft: theme.spacing[6], gap: theme.spacing[1] },
}));
function SessionDialog({
  dialog,
  agent,
  context,
  client,
  projects,
  onClose,
}: {
  dialog: "settings" | "bind" | null;
  agent: Agent;
  context: SessionContext | null;
  client: DaemonClient | null;
  projects: SidebarProjectEntry[];
  onClose(): void;
}) {
  if (!client || !context) return null;
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
  if (dialog === "bind")
    return (
      <BindDirectory
        client={client}
        serverId={agent.serverId}
        agentId={agent.id}
        onClose={onClose}
      />
    );
  return null;
}
interface DirectoryRowProps {
  selected: boolean;
  directory: {
    path: string;
    launch: boolean;
    repository: string | null;
    status: import("@/git/checkout-status-cache").CheckoutStatusPayload | undefined;
    query: import("@tanstack/react-query").UseQueryResult<
      import("@/git/checkout-status-cache").CheckoutStatusPayload,
      Error
    >;
  };
  connected: boolean;
  agentId: string;
  open(path: string, kind: "files" | "changes_tree"): void;
  mutation: ReturnType<typeof useContextMutation>;
}
function DirectoryRow({
  directory,
  connected,
  agentId,
  open,
  mutation,
  selected,
}: DirectoryRowProps) {
  const directoryStyle = useMemo(() => [styles.title, selected && styles.selected], [selected]);
  const selectedState = useMemo(() => ({ selected }), [selected]);
  const { t } = useTranslation();
  const status = directory.status;
  const unavailable = directory.query.error?.message ?? status?.error?.message;
  const checkout = status?.isGit ? status.repoRoot : null;
  const worktree = Boolean(checkout && directory.repository !== checkout);
  let detail = directory.query.isPending
    ? t("sessionNavigation.checking")
    : t("sessionNavigation.nonGit");
  if (status?.isGit)
    detail = `${worktree ? t("sessionNavigation.worktree") : t("sessionNavigation.mainCheckout")} · ${status.currentBranch ?? t("sessionNavigation.detached")}`;
  if (unavailable) detail = t("sessionNavigation.unavailable", { reason: unavailable });
  if (!connected) detail = t("sessionNavigation.offline");
  const openFiles = useCallback(() => open(directory.path, "files"), [open, directory.path]);
  const openChanges = useCallback(
    () => open(directory.path, "changes_tree"),
    [open, directory.path],
  );
  const retryDirectory = useCallback(() => {
    void directory.query.refetch();
  }, [directory.query]);
  const removeBinding = useCallback(
    () => mutation.mutate({ kind: "unlink", path: directory.path }),
    [mutation, directory.path],
  );
  return (
    <View key={directory.path}>
      <View style={styles.row}>
        <PressHighlight
          accessibilityRole="button"
          style={directoryStyle}
          accessibilityState={selectedState}
          onPress={openFiles}
          testID={`session-directory-${agentId}-${directory.path}`}
        >
          <Text style={unavailable ? styles.hint : styles.text} numberOfLines={1}>
            {directoryDisplayPath(directory.path)}
          </Text>
          <Text style={styles.hint}>
            {directory.launch ? t("sessionNavigation.launchExecution") : ""}
            {detail}
          </Text>
        </PressHighlight>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={t("sessionNavigation.directoryActions", { path: directory.path })}
          >
            <Text style={styles.menu}>⋯</Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={directory.path}>
            <DropdownMenuItem onSelect={openFiles}>{t("sessionNavigation.files")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={openChanges}>
              {t("sessionNavigation.changes")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={directory.query.isFetching || !connected}
              onSelect={retryDirectory}
            >
              {t("sessionNavigation.retry")}
            </DropdownMenuItem>
            {!directory.launch ? (
              <DropdownMenuItem disabled={mutation.isPending} onSelect={removeBinding}>
                {t("sessionNavigation.remove")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
    </View>
  );
}
function WorktreeButton({
  repository,
  select,
}: {
  repository: string;
  select(repository: string): void;
}) {
  const { t } = useTranslation();
  const create = useCallback(() => select(repository), [select, repository]);
  return (
    <Button variant="ghost" size="sm" onPress={create}>
      {t("sessionNavigation.newWorktree")}
    </Button>
  );
}
function directoryDisplayPath(path: string): string {
  const short = shortenPath(path);
  if (short.length <= 36) return short;
  const segments = short.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? short;
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
  directoryTarget,
}: {
  directoryTarget: Extract<
    import("@/workspace-tabs/model").WorkspaceTabTarget,
    { kind: "files" | "changes_tree" | "working_diff" | "file" | "commit_diff" }
  > | null;
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
      activeDirectoryPath={
        activeWorkspace?.serverId === agent.serverId && directoryTarget?.sessionAgentId === agent.id
          ? directoryTarget.directory
          : undefined
      }
      client={target?.client ?? null}
      context={context}
      contextError={snapshot?.status === "error" ? snapshot.message : null}
      supported={source?.supported === true}
      projects={projects}
      dismiss={dismiss}
      hostBadge={model.badges.get(agent.serverId)}
      projectLabel={model.rowItems.project ? project?.projectName : undefined}
      showLabels={model.rowItems.labels}
      shortcutNumber={showShortcutBadges ? model.shortcutIndexBySession.get(key) : undefined}
    />
  );
}
function SessionMetadata({
  agent,
  context,
  hostBadge,
  showLabels,
  projectLabel,
}: {
  agent: Agent;
  context: SessionContext | null;
  hostBadge?: import("@/hosts/appearance").HostBadgeModel;
  showLabels: boolean;
  projectLabel?: string;
}) {
  const { t } = useTranslation();
  const labels = showLabels && context ? context.sidebarLabelNames.join(", ") : "";
  return (
    <View>
      <Text style={styles.hint}>
        {getStatusBucketLabel(sessionStatus(agent), t)}
        {labels ? " · " + labels : ""}
        {projectLabel ? " · " + projectLabel : ""}
        {context
          ? " · " +
            t("sessionNavigation.directoryCount", { count: sessionDirectories(context).length })
          : ""}
      </Text>
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}
