import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { permitsSessionOperation } from "./operations";
import { useTranslation } from "react-i18next";
import { movePinnedSession } from "./model";
import { useSessionNavigationPreferences } from "./preferences";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { openDirectoryForm } from "./directory-form";
import {
  useDeferredValue,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { SessionContext, SessionContextMutation } from "@getpaseo/protocol/session-context";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useWorkspaceLabelProjection } from "@/workspace-labels";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import { contextKey, type ContextSnapshot } from "./contexts";
export function useContextMutation(client: DaemonClient, serverId: string, agentId: string) {
  const cache = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (mutation: SessionContextMutation) => {
      const runtime = getHostRuntimeStore().getSnapshot(serverId);
      if (runtime?.connectionStatus !== "online") throw new Error(t("sessionNavigation.offline"));
      if (
        !permitsSessionOperation(client.getLastServerInfoMessage()?.permissions, "workspace.manage")
      )
        throw new Error(t("sessionNavigation.readOnly"));
      return client.mutateSessionContext(agentId, mutation);
    },
    onSuccess: (payload) =>
      cache.setQueryData<ContextSnapshot>(contextKey(serverId, agentId), {
        status: "ready",
        context: payload.context,
      }),
  });
}
export function SessionSettings({
  client,
  serverId,
  context,
  projects,
  cwd,
  onClose,
}: {
  client: DaemonClient;
  serverId: string;
  context: SessionContext;
  projects: SidebarProjectEntry[];
  cwd: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const mutation = useContextMutation(client, serverId, context.agentId);
  const { sessionNavigation } = useSidebarModel();
  const pinnedGroup = sessionNavigation.groups.find((group) =>
    group.agents.some((agent) => agent.serverId === serverId && agent.id === context.agentId),
  );
  const pinnedPeers =
    pinnedGroup?.agents
      .filter((agent) => {
        const snapshot = sessionNavigation.snapshots.get(agent.serverId + ":" + agent.id);
        return snapshot?.status === "ready" && snapshot.context.pinnedAt;
      })
      .map((agent) => agent.serverId + ":" + agent.id) ?? [];
  const { hosts } = useWorkspaceLabelProjection();
  const labels = hosts.find((host) => host.serverId === serverId)?.labels ?? [];
  const availableProjects = projects.flatMap((project) =>
    project.hosts
      .filter((host) => host.serverId === serverId)
      .map((host) => ({ id: host.projectId, name: project.projectName })),
  );
  const projectName =
    availableProjects.find((project) => project.id === context.projectId)?.name ??
    (context.projectId
      ? t("sessionNavigation.projectUnavailable")
      : t("sessionNavigation.ungrouped"));
  const settingsHeader = useMemo(
    () => ({
      title: t("sessionNavigation.settings"),
      subtitle: <Text style={styles.muted}>{serverId}</Text>,
    }),
    [serverId, t],
  );
  const clearProject = useCallback(
    () => mutation.mutate({ kind: "project", projectId: null }),
    [mutation],
  );
  const togglePinned = useCallback(
    () => mutation.mutate({ kind: "pin", pinned: !context.pinnedAt }),
    [mutation, context.pinnedAt],
  );
  return (
    <AdaptiveModalSheet visible onClose={onClose} header={settingsHeader} testID="session-settings">
      <View style={styles.body}>
        {mutation.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {mutation.error.message}
          </Text>
        ) : null}
        <Field label={t("sessionNavigation.project")}>
          <DropdownMenu compactMode="sheet">
            <DropdownMenuTrigger disabled={mutation.isPending}>
              <Text style={styles.text}>{projectName} ▾</Text>
            </DropdownMenuTrigger>
            <DropdownMenuContent sheetTitle={t("sessionNavigation.project")}>
              <DropdownMenuItem onSelect={clearProject}>
                {t("sessionNavigation.ungrouped")}
              </DropdownMenuItem>
              {availableProjects.map((project) => (
                <ProjectChoice
                  key={project.id}
                  id={project.id}
                  name={project.name}
                  mutation={mutation}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
        <Button variant="outline" disabled={mutation.isPending} onPress={togglePinned}>
          {context.pinnedAt ? t("sessionNavigation.unpin") : t("sessionNavigation.pin")}
        </Button>
        {context.pinnedAt ? (
          <PinnedSessionOrder serverId={serverId} agentId={context.agentId} peers={pinnedPeers} />
        ) : null}
        <Field label={t("sessionNavigation.labels")}>
          <View style={styles.body}>
            {labels.map((label) => (
              <LabelChoice
                key={label.name}
                name={label.name}
                assigned={context.sidebarLabelNames.includes(label.name)}
                mutation={mutation}
              />
            ))}
          </View>
        </Field>
        <Field label={t("sessionNavigation.executionReadOnly")}>
          <Text selectable style={styles.text}>
            {cwd}
          </Text>
        </Field>
        <Text style={styles.muted}>{t("sessionNavigation.bindingHint")}</Text>
        {mutation.isPending ? (
          <Text style={styles.muted}>{t("sessionNavigation.saving")}</Text>
        ) : null}
      </View>
    </AdaptiveModalSheet>
  );
}
function useDirectoryForm(ports: Parameters<typeof openDirectoryForm>[0]) {
  const [model] = useState(() => openDirectoryForm(ports));
  useEffect(() => () => model.close(), [model]);
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  return { model, state };
}
export function BindDirectory({
  client,
  agentId,
  serverId,
  onClose,
}: {
  client: DaemonClient;
  agentId: string;
  serverId: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const { model, state } = useDirectoryForm({
    link: async (path) => {
      const payload = await client.mutateSessionContext(agentId, { kind: "link", path });
      cache.setQueryData<ContextSnapshot>(contextKey(serverId, agentId), {
        status: "ready",
        context: payload.context,
      });
    },
    success: onClose,
  });
  const deferredPath = useDeferredValue(state.input);
  const suggestions = useFetchQuery({
    dataShape: "value",
    queryKey: ["session-directory-suggestions", serverId, deferredPath],
    queryFn: () =>
      client.getDirectorySuggestions({
        query: deferredPath,
        includeDirectories: true,
        includeFiles: false,
        limit: 10,
      }),
    enabled: deferredPath.length > 1,
    staleTimeMs: 10000,
  });
  const header = useMemo(
    () => ({
      title: t("sessionNavigation.bind"),
      subtitle: <Text style={styles.muted}>{serverId}</Text>,
    }),
    [serverId, t],
  );
  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header} testID="bind-session-directory">
      <View style={styles.body}>
        <Field
          label={t("sessionNavigation.directory")}
          error={state.error}
          testID="session-directory-field"
        >
          <FormTextInput
            initialValue={state.input}
            resetKey={state.inputRevision}
            onChangeText={model.setInput}
            placeholder={t("sessionNavigation.pathPlaceholder")}
            testID="session-directory-path"
            editable={state.status !== "pending"}
          />
        </Field>
        {suggestions.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {suggestions.error.message}
          </Text>
        ) : null}
        {suggestions.data?.entries
          ?.filter((entry) => entry.kind === "directory")
          .map((entry) => (
            <PathSuggestion key={entry.path} path={entry.path} select={model.choosePath} />
          ))}
        <Text style={styles.muted}>{t("sessionNavigation.bindingHint")}</Text>
        <Button
          disabled={state.status === "pending" || !state.input.trim()}
          testID="bind-session-directory-submit"
          onPress={model.submit}
        >
          {state.status === "pending"
            ? t("sessionNavigation.binding")
            : t("sessionNavigation.bind")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
export function CreateSessionWorktree({
  client,
  serverId,
  agentId,
  repository,
  onClose,
}: {
  client: DaemonClient;
  serverId: string;
  agentId: string;
  repository: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const { model, state } = useDirectoryForm({
    create: async (name) => {
      const result = await client.createPaseoWorktree({
        cwd: repository,
        worktreeSlug: name,
        action: "branch-off",
      });
      if (result.error || !result.workspace)
        throw new Error(result.error ?? t("sessionNavigation.worktreeFailed"));
      return result.workspace.workspaceDirectory;
    },
    link: async (path) => {
      const payload = await client.mutateSessionContext(agentId, { kind: "link", path });
      cache.setQueryData<ContextSnapshot>(contextKey(serverId, agentId), {
        status: "ready",
        context: payload.context,
      });
    },
    success: onClose,
  });
  const header = useMemo(
    () => ({
      title: t("sessionNavigation.newWorktree"),
      subtitle: <Text style={styles.muted}>{repository}</Text>,
    }),
    [repository, t],
  );
  return (
    <AdaptiveModalSheet visible onClose={onClose} header={header}>
      <View style={styles.body}>
        <Field label={t("sessionNavigation.worktreeName")} error={state.error}>
          <FormTextInput
            initialValue={state.input}
            onChangeText={model.setInput}
            editable={state.status !== "pending" && !state.createdPath}
          />
        </Field>
        {state.createdPath ? (
          <Text selectable style={styles.muted}>
            {t("sessionNavigation.worktreeCreated", { path: state.createdPath })}
          </Text>
        ) : null}
        <Text style={styles.muted}>{t("sessionNavigation.worktreeHint")}</Text>
        <Button disabled={state.status === "pending" || !state.input.trim()} onPress={model.submit}>
          {state.status === "pending"
            ? t("sessionNavigation.creating")
            : t("sessionNavigation.createAndBind")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}
const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  text: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
}));
interface ChoiceMutationProps {
  mutation: ReturnType<typeof useContextMutation>;
}
function ProjectChoice({
  id,
  name,
  mutation,
}: ChoiceMutationProps & {
  id: string;
  name: string;
}) {
  const select = useCallback(
    () => mutation.mutate({ kind: "project", projectId: id }),
    [mutation, id],
  );
  return (
    <DropdownMenuItem disabled={mutation.isPending} onSelect={select}>
      {name}
    </DropdownMenuItem>
  );
}
function LabelChoice({
  name,
  assigned,
  mutation,
}: ChoiceMutationProps & {
  name: string;
  assigned: boolean;
}) {
  const toggle = useCallback(
    () => mutation.mutate({ kind: "label", name, assigned: !assigned }),
    [mutation, name, assigned],
  );
  return (
    <Button variant="ghost" disabled={mutation.isPending} onPress={toggle}>
      {assigned ? "✓ " : ""}
      {name}
    </Button>
  );
}
function PathSuggestion({ path, select }: { path: string; select(path: string): void }) {
  const choose = useCallback(() => select(path), [path, select]);
  return (
    <Button variant="ghost" onPress={choose}>
      {path}
    </Button>
  );
}
function PinnedSessionOrder({
  serverId,
  agentId,
  peers,
}: {
  serverId: string;
  agentId: string;
  peers: string[];
}) {
  const { t } = useTranslation();
  const key = serverId + ":" + agentId;
  const index = peers.indexOf(key);
  const move = useCallback(
    (delta: number) => {
      const neighbor = peers[index + delta];
      if (!neighbor) return;
      const state = useSessionNavigationPreferences.getState();
      state.setPinnedOrder(movePinnedSession(state.pinnedOrder, key, neighbor));
    },
    [peers, index, key],
  );
  const up = useCallback(() => move(-1), [move]);
  const down = useCallback(() => move(1), [move]);
  return (
    <View>
      <Button variant="ghost" onPress={up} disabled={index <= 0}>
        {t("sessionNavigation.moveUp")}
      </Button>
      <Button variant="ghost" onPress={down} disabled={index < 0 || index >= peers.length - 1}>
        {t("sessionNavigation.moveDown")}
      </Button>
    </View>
  );
}
