import { z } from "zod";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import {
  MenuBarQuotaAccountSchema,
  MagpieGroupSchema,
  type MenuBarQuotaReport,
} from "../../../../desktop/src/features/menu-bar/quotas";

const quotaPayload = z.object({
  available: z.boolean(),
  quotas: z.array(MenuBarQuotaAccountSchema).max(128),
  groups: z.array(MagpieGroupSchema).max(128).optional(),
  speedControlReady: z.boolean().optional(),
});

interface QuotaInput {
  hostId: string;
  hostLabel: string;
  payload: unknown;
  now: number;
}

export function deriveMenuBarQuotaReport(input: QuotaInput): MenuBarQuotaReport {
  // Strip every non-quota field before crossing into Electron main.
  const payload = quotaPayload.parse(input.payload);
  return {
    hostId: input.hostId,
    hostLabel: input.hostLabel,
    state: payload.available ? "ready" : "unavailable",
    checkedAt: input.now,
    accounts: payload.available ? payload.quotas : [],
    ...(payload.groups
      ? {
          groups: payload.groups.filter((group) => group.controllable),
          speedControlReady: payload.speedControlReady === true,
        }
      : {}),
    ...(!payload.available ? { issue: "Magpie 网关不可用，请打开账号管理检查服务。" } : {}),
  };
}

interface FetchInput {
  hostId: string;
  hostLabel: string;
  client: Pick<DaemonClient, "getPluginCatalog" | "invokePluginRpc">;
  refresh?: boolean;
}

export async function fetchMenuBarQuota(input: FetchInput): Promise<MenuBarQuotaReport> {
  const unavailable: MenuBarQuotaReport = {
    hostId: input.hostId,
    hostLabel: input.hostLabel,
    state: "unavailable",
    checkedAt: 0,
    accounts: [],
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<MenuBarQuotaReport>((resolve) => {
    timer = setTimeout(() => resolve({ ...unavailable, issue: "额度请求超时，请重试。" }), 25_000);
  });
  async function fetch() {
    const catalog = await input.client.getPluginCatalog();
    if (!catalog.some((plugin) => plugin.id === "magpie")) {
      return { ...unavailable, state: "not-configured" as const };
    }
    const payload = await input.client.invokePluginRpc("magpie", "magpie.snapshot", {
      refresh: input.refresh === true,
    });
    return deriveMenuBarQuotaReport({ ...input, payload, now: Date.now() });
  }
  try {
    return await Promise.race([fetch(), deadline]);
  } catch (error) {
    // RPC failure or a malformed plugin response makes only this host unavailable.
    return {
      ...unavailable,
      issue:
        error instanceof z.ZodError
          ? "Magpie 数据格式不兼容，请更新插件。"
          : "主机请求失败，请检查连接后重试。",
    };
  } finally {
    clearTimeout(timer);
  }
}
