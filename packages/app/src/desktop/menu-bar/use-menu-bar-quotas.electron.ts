import { queryClient } from "@/data/query-client";
import { listReports, usageReportsQueryKey, useUsageHosts } from "@/usage/queries";
import type { UsageReportEntry } from "@/usage/types";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import type { MutableDaemonConfig } from "@getpaseo/protocol/messages";
import { useFetchQueries, useReplicaQueries } from "@/data/query";
import { getDesktopHost } from "@/desktop/host";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import type { MenuBarQuotaReport } from "../../../../desktop/src/features/menu-bar/quotas";
import { fetchMenuBarQuota, withAntigravityUsage } from "./quotas";

export function readMenuBarQuota(
  host: { serverId: string; label: string },
  online: boolean,
): MenuBarQuotaReport {
  const initial: MenuBarQuotaReport = {
    hostId: host.serverId,
    hostLabel: host.label,
    state: online ? "loading" : "unavailable",
    checkedAt: 0,
    accounts: [],
    issue: online ? undefined : "主机未连接，请恢复连接后重试。",
  };
  if (!online) return initial;
  const magpie =
    queryClient.getQueryData<MenuBarQuotaReport>([
      "menu-bar",
      "magpie-quotas",
      host.serverId,
      "online",
    ]) ?? initial;
  const config = queryClient.getQueryData<MutableDaemonConfig>(daemonConfigQueryKey(host.serverId));
  if (config?.usage?.enabled === false) return magpie;
  const entries = queryClient.getQueryData<UsageReportEntry[]>(usageReportsQueryKey(host.serverId));
  return withAntigravityUsage(magpie, entries ?? []);
}

export function useMenuBarQuotas(): MenuBarQuotaReport[] {
  const hosts = useUsageHosts();
  const desktop = getDesktopHost();
  const enabled = desktop?.platform === "darwin" && Boolean(desktop.menuBar);
  const configQueries = useReplicaQueries<MutableDaemonConfig>(
    hosts.map((host) => {
      const client = getHostRuntimeStore().getClient(host.serverId);
      return {
        queryKey: daemonConfigQueryKey(host.serverId),
        enabled:
          enabled &&
          host.isConnected &&
          client?.getLastServerInfoMessage()?.features?.usageSetting === true,
        pushEvent: "status:daemon_config_changed",
        queryFn: async () => {
          if (!client) throw new Error("主机未连接。");
          return (await client.getDaemonConfig()).config;
        },
      };
    }),
  );
  useFetchQueries<UsageReportEntry[]>(
    hosts.map((host, index) => ({
      queryKey: usageReportsQueryKey(host.serverId),
      enabled:
        enabled &&
        host.isConnected &&
        host.supportsUsage &&
        (!configQueries[index].isEnabled ||
          (configQueries[index].data != null &&
            configQueries[index].data.usage?.enabled !== false)),
      dataShape: "value",
      staleTimeMs: 60_000,
      refetchInterval: 300_000,
      refetchIntervalInBackground: true,
      retry: false,
      notifyOnChangeProps: "all",
      queryFn: () => listReports(queryClient, host.serverId),
    })),
  );
  useFetchQueries<MenuBarQuotaReport>(
    hosts.map((host) => ({
      queryKey: [
        "menu-bar",
        "magpie-quotas",
        host.serverId,
        host.isConnected ? "online" : "offline",
      ],
      enabled: enabled && host.isConnected,
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
  return hosts.map((host) => readMenuBarQuota(host, host.isConnected));
}
