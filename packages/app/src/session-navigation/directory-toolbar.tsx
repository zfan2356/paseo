import { useFetchQuery } from "@/data/query";
import { checkoutStatusQueryKey } from "@/git/query-keys";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { usePaneContext } from "@/panels/pane-context";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useSessionNavigationPreferences } from "./preferences";
import { useSessionContexts } from "./contexts";
import {
  sessionDirectories,
  visibleSessionAgents,
  executionDirectoryLabel,
  readDirectoryFacts,
} from "./model";
import { BindDirectory, CreateSessionWorktree, useContextMutation } from "./actions";
import { permitsSessionOperation } from "./operations";
import { isWeb } from "@/constants/platform";
import { ChangeRequestsDialog } from "@/agent-change-requests/section";

export function useSessionDirectoryTarget() {
  const { serverId, workspaceId, target } = usePaneContext();
  const { t } = useTranslation();
  const scope = directoryTargetScope(target);
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const active = useRetainedPanelActive();
  const savedKey = useSessionNavigationPreferences((state) => state.selectedSessionKey);
  const selectedPaths = useSessionNavigationPreferences(
    (state) => state.selectedDirectoryBySession,
  );
  const { agent, supported, permissions } = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      const explicitId = scope.sessionAgentId;
      const focused = session?.agents.get(session.focusedAgentId ?? "");
      const saved = savedKey?.startsWith(serverId + ":")
        ? session?.agents.get(savedKey.slice(serverId.length + 1))
        : undefined;
      const roots = session ? visibleSessionAgents(session.agents) : [];
      const selected = explicitId
        ? session?.agents.get(explicitId)
        : [focused, saved, ...roots].find(
            (candidate) => candidate?.workspaceId === workspaceId && !candidate.archivedAt,
          );
      return {
        agent: selected,
        supported: session?.serverInfo?.features?.sessionContext === true,
        permissions: session?.serverInfo?.permissions,
      };
    }),
  );
  const agentId = agent?.id;
  const targets = useMemo(
    () =>
      agentId
        ? [{ serverId, agentId, client, supported, enabled: supported && connected && active }]
        : [],
    [serverId, agentId, client, supported, connected, active],
  );
  const snapshots = useSessionContexts(targets);
  const snapshot = agent ? snapshots.get(`${serverId}:${agent.id}`) : undefined;
  const context = snapshot?.status === "ready" ? snapshot.context : null;
  const savedPath = agent ? selectedPaths?.[`${serverId}:${agent.id}`] : undefined;
  const explicitDirectory = scope.directory;
  const directory =
    explicitDirectory ??
    (sessionDirectories(context).some(({ path }) => path === savedPath) ? savedPath : undefined) ??
    agent?.cwd;
  const facts = useFetchQuery({
    dataShape: "value",
    queryKey: checkoutStatusQueryKey(serverId, directory ?? ""),
    queryFn: () => {
      if (!client || !directory) throw new Error(t("common.errors.daemonUnavailable"));
      return readDirectoryFacts({
        client,
        path: directory,
        refreshError: t("sessionNavigation.refreshError"),
      });
    },
    enabled: !!client && !!directory && connected && active,
    staleTimeMs: 15000,
    retry: false,
  });
  return {
    agent,
    facts,
    context,
    client,
    directory,
    serverId,
    connected,
    permissions,
    sessionAgentId: scope.sessionAgentId ?? agentId,
    error: snapshot?.status === "error" ? snapshot.message : null,
  };
}

export function SessionDirectoryToolbar({
  selection,
}: {
  selection: ReturnType<typeof useSessionDirectoryTarget>;
}) {
  const { target, retargetCurrentTab } = usePaneContext();
  const { agent, context, client, directory, serverId, connected, permissions } = selection;
  const [binding, setBinding] = useState(false);
  const [worktree, setWorktree] = useState(false);
  const openWorktree = useCallback(() => setWorktree(true), []);
  const closeWorktree = useCallback(() => setWorktree(false), []);
  const repository = selection.facts.data?.isGit
    ? (selection.facts.data.mainRepoRoot ?? selection.facts.data.repoRoot)
    : null;
  const openBinding = useCallback(() => setBinding(true), []);
  const closeBinding = useCallback(() => setBinding(false), []);
  const agentId = agent?.id;
  const selectDirectory = useCallback(
    (path: string) => {
      if (
        !agentId ||
        (target.kind !== "files" &&
          target.kind !== "changes_tree" &&
          target.kind !== "working_diff")
      )
        return;
      useSessionNavigationPreferences.getState().selectDirectory(`${serverId}:${agentId}`, path);
      if (target.directory !== undefined || target.sessionAgentId !== undefined) {
        retargetCurrentTab({ kind: target.kind, directory: path, sessionAgentId: agentId });
      }
    },
    [serverId, agentId, target, retargetCurrentTab],
  );
  if (selection.error)
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        {selection.error}
      </Text>
    );
  if (
    !agent ||
    !context ||
    !client ||
    (target.kind !== "files" && target.kind !== "changes_tree" && target.kind !== "working_diff")
  )
    return null;
  return (
    <DirectoryChoices
      agentId={agent.id}
      serverId={serverId}
      client={client}
      context={context}
      directory={directory}
      canManage={connected && permitsSessionOperation(permissions, "workspace.manage")}
      canWrite={connected && permitsSessionOperation(permissions, "workspace.write")}
      onBind={openBinding}
      onWorktree={repository ? openWorktree : undefined}
      onSelect={selectDirectory}
    >
      {worktree && repository ? (
        <CreateSessionWorktree
          client={client}
          serverId={serverId}
          agentId={agent.id}
          repository={repository}
          onClose={closeWorktree}
        />
      ) : null}
      {binding ? (
        <BindDirectory
          client={client}
          serverId={serverId}
          agentId={agent.id}
          onClose={closeBinding}
        />
      ) : null}
    </DirectoryChoices>
  );
}

function DirectoryChoices({
  agentId,
  serverId,
  client,
  context,
  directory,
  canManage,
  canWrite,
  onBind,
  onWorktree,
  onSelect,
  children,
}: {
  agentId: string;
  serverId: string;
  client: NonNullable<ReturnType<typeof useHostRuntimeClient>>;
  context: import("@getpaseo/protocol/session-context").SessionContext;
  directory?: string;
  canManage: boolean;
  canWrite: boolean;
  onBind(): void;
  onWorktree?: () => void;
  onSelect(path: string): void;
  children: import("react").ReactNode;
}) {
  const { t } = useTranslation();
  const [linkingChangeRequests, setLinkingChangeRequests] = useState(false);
  const openChangeRequests = useCallback(() => setLinkingChangeRequests(true), []);
  const closeChangeRequests = useCallback(() => setLinkingChangeRequests(false), []);
  const supportsChangeRequests = isWeb && client.supportsAgentChangeRequests();
  const mutation = useContextMutation(client, serverId, agentId);
  const directories = sessionDirectories(context);
  const paths = directories.map(({ path }) => path);
  const removable = context.linkedDirectories.some(({ path }) => path === directory);
  const remove = useCallback(async () => {
    if (!directory) return;
    try {
      await mutation.mutateAsync({ kind: "unlink", path: directory });
      onSelect(context.launchDirectory);
    } catch {
      /* The mutation error stays visible beside the directory selector. */
    }
  }, [directory, mutation, onSelect, context.launchDirectory]);
  return (
    <View style={styles.wrapper} testID="session-directory-toolbar">
      <View style={styles.row}>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={t("sessionNavigation.selectDirectory")}
            testID="session-directory-select"
            style={styles.selector}
          >
            <Text numberOfLines={1} style={styles.text}>
              {executionDirectoryLabel(directory ?? context.launchDirectory, paths)} ▾
            </Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={t("sessionNavigation.selectDirectory")}>
            {directories.map(({ path, launch }) => (
              <DirectoryChoice key={path} path={path} launch={launch} select={onSelect} />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu compactMode="sheet">
          <DropdownMenuTrigger
            accessibilityRole="button"
            accessibilityLabel={t("sessionNavigation.directoryActions", { path: directory })}
            testID="session-directory-actions"
          >
            <Text style={styles.menu}>⋯</Text>
          </DropdownMenuTrigger>
          <DropdownMenuContent sheetTitle={t("sessionNavigation.selectDirectory")}>
            {supportsChangeRequests ? (
              <DropdownMenuItem
                disabled={!canWrite}
                onSelect={openChangeRequests}
                testID="session-directory-link-change-request"
              >
                {t("agentChangeRequests.link")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem disabled={!canManage || mutation.isPending} onSelect={onBind}>
              {t("sessionNavigation.addDirectory")}
            </DropdownMenuItem>
            {onWorktree ? (
              <DropdownMenuItem disabled={!canManage || mutation.isPending} onSelect={onWorktree}>
                {t("sessionNavigation.newWorktree")}
              </DropdownMenuItem>
            ) : null}
            {removable ? (
              <DropdownMenuItem disabled={!canManage || mutation.isPending} onSelect={remove}>
                {t("sessionNavigation.remove")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </View>
      {mutation.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {mutation.error.message}
        </Text>
      ) : null}
      {children}
      {linkingChangeRequests ? (
        <ChangeRequestsDialog
          key={agentId}
          client={client}
          agentId={agentId}
          onClose={closeChangeRequests}
        />
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  wrapper: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    padding: theme.spacing[2],
  },
  row: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  selector: { flex: 1, minWidth: 0, paddingVertical: theme.spacing[2] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  menu: { color: theme.colors.foregroundMuted, padding: theme.spacing[2] },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));

function DirectoryChoice({
  path,
  launch,
  select,
}: {
  path: string;
  launch: boolean;
  select(path: string): void;
}) {
  const { t } = useTranslation();
  const choose = useCallback(() => select(path), [path, select]);
  return (
    <DropdownMenuItem onSelect={choose}>
      {path}
      {launch ? ` · ${t("sessionNavigation.launchExecution")}` : ""}
    </DropdownMenuItem>
  );
}

function directoryTargetScope(target: import("@/workspace-tabs/model").WorkspaceTabTarget) {
  return {
    directory: "directory" in target ? target.directory : undefined,
    sessionAgentId: "sessionAgentId" in target ? target.sessionAgentId : undefined,
  };
}
