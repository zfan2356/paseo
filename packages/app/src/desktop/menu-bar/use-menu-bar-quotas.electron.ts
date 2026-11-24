import { useMemo } from "react";
import { useFetchQueries } from "@/data/query";
import { getDesktopHost } from "@/desktop/host";
import {
  getHostRuntimeStore,
  useHosts,
  useHostRuntimeConnectionStatuses,
} from "@/runtime/host-runtime";
import type { MenuBarQuotaReport } from "../../../../desktop/src/features/menu-bar/quotas";
import { fetchMenuBarQuota } from "./quotas";

export function useMenuBarQuotas(): MenuBarQuotaReport[] {
  const hosts = useHosts();
  const ids = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const statuses = useHostRuntimeConnectionStatuses(ids);
  const desktop = getDesktopHost();
  const enabled = desktop?.platform === "darwin" && Boolean(desktop.menuBar);
  const queries = useFetchQueries<MenuBarQuotaReport>(
    hosts.map((host) => ({
      queryKey: ["menu-bar", "magpie-quotas", host.serverId, statuses.get(host.serverId)],
      enabled: enabled && statuses.get(host.serverId) === "online",
      dataShape: "value",
      staleTimeMs: 60_000,
      refetchInterval: (query) => (query.state.data?.state === "unavailable" ? 10_000 : 60_000),
      refetchIntervalInBackground: true,
      retry: false,
      notifyOnChangeProps: "all",
      queryFn: async () => {
        const client = getHostRuntimeStore().getClient(host.serverId);
        if (!client)
          return {
            hostId: host.serverId,
            hostLabel: host.label,
            state: "unavailable",
            checkedAt: 0,
            accounts: [],
          };
        return fetchMenuBarQuota({ hostId: host.serverId, hostLabel: host.label, client });
      },
    })),
  );
  return hosts.map((host, index) => {
    const online = statuses.get(host.serverId) === "online";
    const report = queries[index].data;
    if (online && report)
      return {
        hostId: host.serverId,
        hostLabel: host.label,
        state: report.state,
        checkedAt: report.checkedAt,
        accounts: report.accounts,
        groups: report.groups,
        speedControlReady: report.speedControlReady,
        issue: report.issue,
      };
    return {
      hostId: host.serverId,
      hostLabel: host.label,
      state: online ? "loading" : "unavailable",
      checkedAt: 0,
      accounts: [],
      issue: online ? "等待主机返回数据。" : "主机未连接，请打开 Paseo 检查连接。",
    };
  });
}
