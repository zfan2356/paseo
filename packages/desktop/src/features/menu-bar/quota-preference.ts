import { z } from "zod";
import type { MenuBarQuotaItem } from "./quotas.js";

export const MenuBarQuotaPreferenceSchema = z.object({
  accountId: z.string().max(2048).nullable().catch(null),
  display: z.enum(["remaining", "used", "hidden"]).catch("remaining"),
});
export type MenuBarQuotaPreference = z.infer<typeof MenuBarQuotaPreferenceSchema>;
export const DEFAULT_MENU_BAR_QUOTA: MenuBarQuotaPreference = {
  accountId: null,
  display: "remaining",
};

export function menuBarQuotaBadge(
  items: readonly MenuBarQuotaItem[],
  preference: MenuBarQuotaPreference = DEFAULT_MENU_BAR_QUOTA,
): { title: string; summary: string } {
  if (preference.display === "hidden") return { title: "", summary: "" };
  const account = preference.accountId
    ? items.find((item) => item.accountId === preference.accountId)
    : (items.find((item) => item.provider === "codex") ?? items[0]);
  if (!account) return { title: "—%", summary: "账号额度暂不可用" };
  if (account.remaining === null)
    return { title: "—%", summary: `${account.title} · ${account.summary}` };
  const value = preference.display === "used" ? 100 - account.remaining : account.remaining;
  const percent = `${Math.round(value * 10) / 10}%`;
  const label = preference.display === "used" ? "已用" : "剩余";
  return {
    title: `${account.cached ? "~" : ""}${percent}`,
    summary: `${account.title} · ${label} ${percent}${account.cached ? "（缓存）" : ""}`,
  };
}
