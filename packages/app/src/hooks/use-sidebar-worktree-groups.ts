import { useMemo } from "react";
import type { CheckoutStatusResponse } from "@getpaseo/protocol/messages";
import { useFetchQueries } from "@/data/query";
import { checkoutStatusQueryKey } from "@/git/query-keys";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import {
  groupSidebarWorktrees,
  sidebarCheckoutIdentityKey,
} from "@/components/sidebar/sidebar-projection";
import type { SidebarProjectEntry } from "./use-sidebar-workspaces-list";
import { useTranslation } from "react-i18next";

export function useSidebarWorktreeGroups(projects: SidebarProjectEntry[], enabled: boolean) {
  const { t } = useTranslation();
  const targets = useMemo(
    () => projects.flatMap((project) => (project.projectKind === "git" ? project.hosts : [])),
    [projects],
  );
  const serverIds = useMemo(() => [...new Set(targets.map((host) => host.serverId))], [targets]);
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const results = useFetchQueries<CheckoutStatusResponse["payload"]>(
    targets.map((host) => ({
      dataShape: "value",
      queryKey: checkoutStatusQueryKey(host.serverId, host.iconWorkingDir),
      queryFn: () => {
        const client = getHostRuntimeStore().getClient(host.serverId);
        if (!client) throw new Error(t("common.errors.daemonUnavailable"));
        return client.getCheckoutStatus(host.iconWorkingDir);
      },
      enabled: enabled && statuses.get(host.serverId) === "online",
      staleTimeMs: 15000,
      retry: false,
    })),
  );
  return groupSidebarWorktrees(
    projects,
    new Map(
      targets.flatMap((host, index) => {
        const result = results[index];
        return result.data && !result.isError
          ? [[sidebarCheckoutIdentityKey(host.serverId, host.iconWorkingDir), result.data]]
          : [];
      }),
    ),
  );
}
