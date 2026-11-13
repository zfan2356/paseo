import { useShowShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { useTranslation } from "react-i18next";
import { getStatusBucketLabel, STATUS_BUCKET_ORDER } from "@/hooks/sidebar-status-view-model";
import { useSidebarWorkspaceTrailing } from "@/components/sidebar/workspace-trailing";
import { useCompactTimeAgo } from "@/hooks/use-time-ago";
import { Fragment, memo, useCallback, useState, type ReactNode } from "react";
import { Text, View, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation } from "@tanstack/react-query";
import { useFetchQueries } from "@/data/query";
import type { SessionContext } from "@getpaseo/protocol/session-context";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { HostBadge } from "@/hosts/host-badge";
import { sessionStatus } from "./projection";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { type Agent } from "@/stores/session-store";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useSessionNavigationPreferences } from "./preferences";
import { sessionDirectories, groupDirectories } from "./model";
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
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";

import { checkoutStatusQueryKey } from "@/git/query-keys";
import { shortenPath } from "@/utils/shorten-path";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
export function SessionSidebar({
  children,
  dismiss,
  header,
}: {
  header: ReactNode;
  children: ReactNode;
  dismiss?: () => void;
}) {
  const { sessionNavigation, allProjects } = useSidebarModel();
  const [resources, setResources] = useState(false);
  const showShortcutBadges = useShowShortcutBadges();
  const search = useSessionNavigationPreferences((state) => state.search);
  const setSearch = useSessionNavigationPreferences((state) => state.setSearch);
  const toggleResources = useCallback(() => setResources((value) => !value), []);
  return (
    <View style={styles.fill}>
      {header}
      <View style={styles.search}>
        <FormTextInput
          initialValue={search}
          onChangeText={setSearch}
          placeholder="Search sessions and directories"
          accessibilityLabel="Search sessions and directories"
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
              Update {host.label ?? host.serverId} to use session directories. Chat and directory
              resources remain available.
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
              />
            ))}
          </SessionGroup>
        ))}
        <Button variant="ghost" onPress={toggleResources} testID="directory-terminal-resources">
          {resources ? "▾" : "▸"} Directories and terminals
        </Button>
        {resources ? (
          <Text style={styles.hint}>
            Open directory resources, terminals and services independently of a session.
          </Text>
        ) : null}
      </ScrollView>
      {resources ? <View style={styles.resources}>{children}</View> : null}
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
  const collapsed = useSidebarCollapsedSectionsStore((state) =>
    mode === "status"
      ? state.collapsedWorkspaceGroupKeys.has(groupKey)
      : state.collapsedProjectKeys.has(groupKey),
  );
  const toggleGroup = useSidebarCollapsedSectionsStore((state) =>
    mode === "status" ? state.toggleWorkspaceGroupCollapsed : state.toggleProjectCollapsed,
  );
  const toggleGroupCollapsed = useCallback(() => toggleGroup(groupKey), [toggleGroup, groupKey]);
  return (
    <View>
      <Button variant="ghost" style={styles.groupToggle} onPress={toggleGroupCollapsed}>
        {collapsed ? "▸" : "▾"} {displayName}
      </Button>
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
}: {
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
  const trailing = useSidebarWorkspaceTrailing();
  const key = `${agent.serverId}:${agent.id}`;
  const expanded = useSessionNavigationPreferences((state) => state.expanded[key] === true);
  const toggle = useSessionNavigationPreferences((state) => state.toggleExpanded);
  const [dialog, setDialog] = useState<"settings" | "bind" | null>(null);
  const archive = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error("Host offline");
      return client.archiveAgent(agent.id);
    },
  });
  const openChat = useCallback(() => {
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
      <View style={styles.row}>
        <Button
          variant="ghost"
          size="sm"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} session directories`}
          onPress={toggleSessionExpanded}
          disabled={!supported}
        >
          {expanded ? "▾" : "▸"}
        </Button>
        <PressHighlight style={styles.title} onPress={openChat} accessibilityRole="button">
          <Text numberOfLines={1} style={styles.text}>
            {context?.pinnedAt ? "⌖ " : ""}
            {agent.title ?? "Untitled session"}
          </Text>
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
          <DropdownMenuTrigger accessibilityRole="button" accessibilityLabel="Session menu">
            <Text style={styles.menu}>⋯</Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle="Session">
            <DropdownMenuItem disabled={!context || !client} onSelect={openSettings}>
              Session settings
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!context || !client} onSelect={openBindDirectory}>
              Bind directory
            </DropdownMenuItem>
            <DropdownMenuItem disabled={archive.isPending} onSelect={archiveSession}>
              Archive session
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
      {expanded && !context ? <Text style={styles.hint}>Loading session directories…</Text> : null}
      {expanded && context && client ? (
        <SessionDirectories
          agent={agent}
          client={client}
          context={context}
          dismiss={dismiss}
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
}: {
  agent: Agent;
  client: DaemonClient;
  context: SessionContext;
  dismiss?: () => void;
  bind(): void;
}) {
  const connected = useHostRuntimeIsConnected(agent.serverId);
  const active = useRetainedPanelActive();
  const compact = useIsCompactFormFactor();
  const mutation = useContextMutation(client, agent.serverId, agent.id);
  const [worktreeRepository, setWorktreeRepository] = useState<string | null>(null);
  const directories = sessionDirectories(context);
  const facts = useFetchQueries(
    directories.map((directory) => ({
      queryKey: checkoutStatusQueryKey(agent.serverId, directory.path),
      queryFn: async () => {
        await client.listDirectory(directory.path, directory.path);
        await client.checkoutRefresh(directory.path);
        return client.getCheckoutStatus(directory.path);
      },
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
              {group.repository ? shortenPath(group.repository) : "Other directories"}
            </Text>
            {group.directories.map((directory) => (
              <DirectoryRow
                key={directory.path}
                directory={directory}
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
        + Bind directory
      </Button>
      {mutation.isPending ? <Text style={styles.hint}>Updating directories…</Text> : null}
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
  groupToggle: { justifyContent: "flex-start" },
  fill: { flex: 1 },
  resources: { flex: 1 },
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
  title: { flex: 1, paddingVertical: theme.spacing[1] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
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
function DirectoryRow({ directory, connected, agentId, open, mutation }: DirectoryRowProps) {
  const status = directory.status;
  const unavailable = directory.query.error?.message ?? status?.error?.message;
  const checkout = status?.isGit ? status.repoRoot : null;
  const worktree = Boolean(checkout && directory.repository !== checkout);
  let detail = directory.query.isPending ? "Checking…" : "Non-Git directory";
  if (status?.isGit)
    detail = `${worktree ? "worktree" : "main checkout"} · ${status.currentBranch ?? "detached HEAD"}`;
  if (unavailable) detail = `Unavailable · ${unavailable}`;
  if (!connected) detail = "Host offline";
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
          style={styles.title}
          onPress={openFiles}
          testID={`session-directory-${agentId}-${directory.path}`}
        >
          <Text style={unavailable ? styles.hint : styles.text} numberOfLines={1}>
            {directoryDisplayPath(directory.path)}
          </Text>
          <Text style={styles.hint}>
            {directory.launch ? "Launch · Execution · " : ""}
            {detail}
          </Text>
        </PressHighlight>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={`Directory actions ${directory.path}`}
          >
            <Text style={styles.menu}>⋯</Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={directory.path}>
            <DropdownMenuItem onSelect={openFiles}>Files</DropdownMenuItem>
            <DropdownMenuItem onSelect={openChanges}>Local changes</DropdownMenuItem>
            <DropdownMenuItem
              disabled={directory.query.isFetching || !connected}
              onSelect={retryDirectory}
            >
              Retry directory
            </DropdownMenuItem>
            {!directory.launch ? (
              <DropdownMenuItem disabled={mutation.isPending} onSelect={removeBinding}>
                Remove binding
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
  const create = useCallback(() => select(repository), [select, repository]);
  return (
    <Button variant="ghost" size="sm" onPress={create}>
      New worktree
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
}: {
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
  const project = projects.find((candidate) =>
    candidate.hosts.some(
      (host) => host.serverId === agent.serverId && host.projectId === context?.projectId,
    ),
  );
  return (
    <SessionRow
      agent={agent}
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
        {context ? " · " + sessionDirectories(context).length + " directories" : ""}
      </Text>
      {hostBadge ? <HostBadge badge={hostBadge} /> : null}
    </View>
  );
}
