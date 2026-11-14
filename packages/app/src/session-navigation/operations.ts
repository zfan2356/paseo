import { useCallback } from "react";
import type { Agent } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useArchiveAgent } from "@/hooks/use-archive-agent";
import { useToast } from "@/contexts/toast-context";
import { contextKey, type ContextSnapshot } from "./contexts";

export type SessionOperation =
  | { kind: "rename"; name: string }
  | { kind: "pin"; pinned: boolean }
  | { kind: "read" }
  | { kind: "archive" };

type SessionPermission = "workspace.write" | "workspace.manage" | "hub.execute";

export function permitsSessionOperation(
  permissions: readonly string[] | undefined,
  permission: SessionPermission,
): boolean {
  // COMPAT(sessionPermissions): added in v0.15.3, remove after 2027-11-14; older daemons omit grants.
  return permissions === undefined || permissions.includes(permission);
}

export function sessionOperationCapabilities({
  connected,
  permissions,
  contextReady,
  agent,
}: {
  connected: boolean;
  permissions: readonly string[] | undefined;
  contextReady: boolean;
  agent: Agent;
}) {
  const canWrite = connected && permitsSessionOperation(permissions, "workspace.write");
  const canManage =
    connected && contextReady && permitsSessionOperation(permissions, "workspace.manage");
  const canArchive =
    connected &&
    (permitsSessionOperation(permissions, "workspace.write") ||
      permitsSessionOperation(permissions, "hub.execute"));
  const canRead =
    canWrite && agent.pendingPermissions.length === 0 && agent.attentionReason !== "permission";
  const readOnly = connected && !canWrite && !canManage && !canArchive;
  return { canWrite, canManage, canArchive, canRead, readOnly };
}

export function useSessionOperations(serverId: string, agentId: string) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const toast = useToast();
  const { archiveAgent } = useArchiveAgent();
  const clientFor = useCallback(
    (permission: SessionPermission): DaemonClient => {
      const runtime = getHostRuntimeStore().getSnapshot(serverId);
      if (runtime?.connectionStatus !== "online" || !runtime.client)
        throw new Error(t("sessionNavigation.offline"));
      const permissions = runtime.client.getLastServerInfoMessage()?.permissions;
      if (!permitsSessionOperation(permissions, permission))
        throw new Error(t("sessionNavigation.readOnly"));
      return runtime.client;
    },
    [serverId, t],
  );
  const mutation = useMutation({
    mutationFn: async (operation: SessionOperation) => {
      if (operation.kind === "pin") {
        const payload = await clientFor("workspace.manage").mutateSessionContext(
          agentId,
          operation,
        );
        cache.setQueryData<ContextSnapshot>(contextKey(serverId, agentId), {
          status: "ready",
          context: payload.context,
        });
        return;
      }
      if (operation.kind === "archive") {
        const runtime = getHostRuntimeStore().getSnapshot(serverId);
        const permissions = runtime?.client?.getLastServerInfoMessage()?.permissions;
        const archivePermission = permitsSessionOperation(permissions, "workspace.write")
          ? "workspace.write"
          : "hub.execute";
        clientFor(archivePermission);
        await archiveAgent({ serverId, agentId });
        return;
      }
      const client = clientFor("workspace.write");
      if (operation.kind === "rename") await client.updateAgent(agentId, { name: operation.name });
      else {
        const agent = useSessionStore.getState().sessions[serverId]?.agents.get(agentId);
        if (agent?.pendingPermissions.length || agent?.attentionReason === "permission") return;
        await client.clearAgentAttention(agentId);
      }
    },
    onError: (error) => toast.error(error.message),
    onSuccess: (_result, operation) => {
      if (operation.kind === "read") toast.show(t("sessionNavigation.markedRead"));
    },
  });
  const assign = useCallback(
    async (label: WorkspaceLabelDefinition, assigned: boolean) => {
      const payload = await clientFor("workspace.manage").mutateSessionContext(agentId, {
        kind: "label",
        name: label.name,
        assigned,
      });
      cache.setQueryData<ContextSnapshot>(contextKey(serverId, agentId), {
        status: "ready",
        context: payload.context,
      });
    },
    [agentId, cache, clientFor, serverId],
  );
  const create = useCallback(
    async (label: WorkspaceLabelDefinition) => {
      const client = clientFor("workspace.manage");
      const created = await client.createWorkspaceLabel(label);
      try {
        await assign(created.label, true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          t("sessionNavigation.labelCreatedAssignmentFailed", {
            name: created.label.name,
            message,
          }),
          { cause: error },
        );
      }
    },
    [clientFor, assign, t],
  );
  return { mutation, assign, create };
}
