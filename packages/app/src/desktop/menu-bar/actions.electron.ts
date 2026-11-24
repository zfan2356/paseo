import { router } from "expo-router";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { queryClient } from "@/data/query-client";
import { buildPluginSurfaceRoute } from "@/plugins/routes";
import { MagpieActionSchema } from "../../../../desktop/src/features/menu-bar/quotas";
import { deriveMenuBarQuotaReport, fetchMenuBarQuota } from "./quotas";

export async function executeMagpieAction(raw: unknown): Promise<void> {
  const action = MagpieActionSchema.parse(raw);
  const runtime = getHostRuntimeStore();
  const host = runtime.getHosts().find((item) => item.serverId === action.hostId);
  const client = runtime.getClient(action.hostId);
  if (!host || !client || runtime.getSnapshot(action.hostId)?.connectionStatus !== "online") {
    throw new Error("主机未连接，请先在 Paseo 中恢复连接。");
  }
  if (action.kind === "magpie") {
    router.push(buildPluginSurfaceRoute(action.hostId, "magpie", { kind: "surface", id: "main" }));
    return;
  }
  let report;
  if (action.kind === "refresh") {
    report = await fetchMenuBarQuota({
      hostId: host.serverId,
      hostLabel: host.label,
      client,
      refresh: true,
    });
  } else {
    const method = action.kind === "source" ? "magpie.source.set" : "magpie.ultra.set";
    const input =
      action.kind === "source"
        ? { groupId: action.groupId, source: action.source }
        : { groupId: action.groupId, enabled: action.enabled };
    const payload = await client.invokePluginRpc("magpie", method, input);
    report = deriveMenuBarQuotaReport({
      hostId: host.serverId,
      hostLabel: host.label,
      payload,
      now: Date.now(),
    });
  }
  queryClient.setQueryData(["menu-bar", "magpie-quotas", host.serverId, "online"], report);
  if (report.state === "unavailable") throw new Error(report.issue || "Magpie 暂不可用。");
}
