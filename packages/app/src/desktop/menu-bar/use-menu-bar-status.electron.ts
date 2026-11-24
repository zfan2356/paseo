import { useEffect, useRef } from "react";
import { getDesktopHost } from "@/desktop/host";
import { getHostRuntimeStore, useHosts, useHostRegistryLoaded } from "@/runtime/host-runtime";
import { deriveMenuBarSnapshot, type MenuBarAgent, type MenuBarHost } from "./status";
import { useMenuBarQuotas } from "./use-menu-bar-quotas.electron";
import { executeMagpieAction } from "./actions.electron";
import { queryClient } from "@/data/query-client";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import type { MenuBarQuotaReport } from "../../../../desktop/src/features/menu-bar/quotas";

export function useMenuBarStatus(agents: readonly MenuBarAgent[]): void {
  const hosts = useHosts();
  const registryLoaded = useHostRegistryLoaded();
  const quotaReports = useMenuBarQuotas();
  const { settings } = useDesktopSettings();
  const quotaPreference = settings.menuBarQuota;
  const latest = useRef({ agents, hosts, registryLoaded, quotaReports, quotaPreference });
  const publishRef = useRef<() => void>(() => {});
  useEffect(() => {
    latest.current = { agents, hosts, registryLoaded, quotaReports, quotaPreference };
    publishRef.current();
  }, [agents, hosts, registryLoaded, quotaReports, quotaPreference]);
  useEffect(() => {
    const desktop = getDesktopHost();
    if (desktop?.platform !== "darwin" || !desktop.menuBar) return;
    const bridge = desktop.menuBar;
    const runtime = getHostRuntimeStore();
    const removeAction = bridge.onAction?.(async ({ requestId, action }) => {
      try {
        await executeMagpieAction(action);
        bridge.actionResult?.({ requestId, ok: true });
      } catch (error) {
        bridge.actionResult?.({
          requestId,
          ok: false,
          error: error instanceof Error ? error.message : "操作失败，请重试。",
        });
      }
    });
    let previous = "";
    function publish(heartbeat = false) {
      const current = latest.current;
      const snapshots: MenuBarHost[] = current.hosts.map((host) => {
        const snapshot = runtime.getSnapshot(host.serverId);
        return {
          serverId: host.serverId,
          label: host.label,
          connectionStatus: snapshot?.connectionStatus ?? "connecting",
          agentDirectoryStatus: snapshot?.agentDirectoryStatus ?? "initial_loading",
        };
      });
      const snapshot = current.registryLoaded
        ? deriveMenuBarSnapshot(current.agents, snapshots)
        : null;
      if (snapshot) {
        snapshot.quotaPreference = current.quotaPreference;
        snapshot.quotaReports = current.hosts.map((host) => {
          const online = runtime.getSnapshot(host.serverId)?.connectionStatus === "online";
          const report = queryClient.getQueryData<MenuBarQuotaReport>([
            "menu-bar",
            "magpie-quotas",
            host.serverId,
            "online",
          ]);
          if (online && report) return report;
          return {
            hostId: host.serverId,
            hostLabel: host.label,
            state: online ? "loading" : "unavailable",
            checkedAt: 0,
            accounts: [],
            issue: online ? "等待主机返回数据。" : "主机未连接，请恢复连接后重试。",
          };
        });
      }
      const serialized = JSON.stringify(snapshot);
      if (!heartbeat && serialized === previous) return;
      previous = serialized;
      void bridge.update(snapshot).catch((error: unknown) => {
        console.warn("[menu-bar] Failed to publish task status", error);
      });
    }
    publishRef.current = () => publish();
    publish();
    const unsubscribe = runtime.subscribeAll(() => publish());
    // Read the cache at publish time, not a React render's earlier async snapshot.
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === "menu-bar") publish();
    });
    const heartbeat = setInterval(() => publish(true), 15_000);
    return () => {
      unsubscribe();
      unsubscribeQueries();
      clearInterval(heartbeat);
      removeAction?.();
      publishRef.current = () => {};
      void bridge.update(null).catch((error: unknown) => {
        console.warn("[menu-bar] Failed to clear task status", error);
      });
    };
  }, []);
}
