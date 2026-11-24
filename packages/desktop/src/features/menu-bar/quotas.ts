import { z } from "zod";

const label = z.string().max(512);
export const MagpieGroupSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9.-]{0,127}$/),
  name: label,
  source: z.enum(["auto", "personal", "ichat", "custom"]),
  controllable: z.boolean(),
  ultraAvailable: z.boolean(),
  ultraEnabled: z.boolean(),
});
export const MagpieActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("refresh"), hostId: label }),
  z.object({ kind: z.literal("magpie"), hostId: label }),
  z.object({
    kind: z.literal("source"),
    hostId: label,
    groupId: z.string(),
    source: z.enum(["auto", "personal", "ichat"]),
  }),
  z.object({ kind: z.literal("ultra"), hostId: label, groupId: z.string(), enabled: z.boolean() }),
]);
export type MagpieAction = z.infer<typeof MagpieActionSchema>;
export const MenuBarQuotaAccountSchema = z.object({
  provider: label,
  name: label,
  user: label,
  plan: label,
  balance: label,
  error: label,
  readAt: label,
  windows: z
    .array(
      z.object({
        name: label,
        remaining: z.number().finite(),
        unlimited: z.boolean(),
        resetsAt: label,
      }),
    )
    .max(32),
});
export const MenuBarQuotaReportSchema = z.object({
  hostId: label,
  hostLabel: label,
  state: z.enum(["ready", "unavailable", "not-configured", "loading"]),
  checkedAt: z.number().nonnegative(),
  accounts: z.array(MenuBarQuotaAccountSchema).max(128),
  groups: z.array(MagpieGroupSchema).max(128).optional(),
  speedControlReady: z.boolean().optional(),
  issue: label.optional(),
});
export type MenuBarQuotaReport = z.infer<typeof MenuBarQuotaReportSchema>;

export interface MenuBarQuotaItem {
  accountId: string;
  provider: string;
  title: string;
  summary: string;
  details: string[];
  remaining: number | null;
  cached: boolean;
}

type QuotaAccount = z.infer<typeof MenuBarQuotaAccountSchema>;
interface AccountObservation {
  accountId: string;
  account: QuotaAccount;
  report: MenuBarQuotaReport;
  sources: Set<string>;
}

function accountIdentity(account: QuotaAccount): string | null {
  const user = account.user.trim();
  const provider = account.provider.trim().toLowerCase();
  // Display names and masked logins cannot establish cross-host identity.
  if (!provider || !/^[^@\s*…]+@[^@\s*…]+\.[^@\s*…]+$/.test(user)) return null;
  const at = user.lastIndexOf("@");
  return JSON.stringify([provider, user.slice(0, at), user.slice(at).toLowerCase()]);
}

function observationIsNewer(candidate: AccountObservation, current: AccountObservation): boolean {
  const hasData = (account: QuotaAccount) =>
    !account.error && (account.windows.length > 0 || Boolean(account.balance));
  if (hasData(candidate.account) !== hasData(current.account)) return hasData(candidate.account);
  const readTime = (account: QuotaAccount) => {
    const time = Date.parse(account.readAt);
    return Number.isFinite(time) ? time : 0;
  };
  const candidateTime = readTime(candidate.account);
  const currentTime = readTime(current.account);
  return candidateTime !== currentTime
    ? candidateTime > currentTime
    : candidate.report.checkedAt > current.report.checkedAt;
}

function percentage(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

export function maskQuotaIdentity(user: string): string {
  if (!user) return "";
  const at = user.indexOf("@");
  return at > 0 ? `${user.slice(0, 1)}***${user.slice(at)}` : `${user.slice(0, 2)}***`;
}

export function menuBarQuotaItems(
  reports: readonly MenuBarQuotaReport[],
  now: number,
): MenuBarQuotaItem[] {
  const observations = new Map<string, AccountObservation>();
  for (const report of reports) {
    // Host connectivity/plugin status is not an account and belongs outside quota cards.
    if (report.state !== "ready") continue;
    for (const [index, account] of report.accounts.entries()) {
      const key =
        accountIdentity(account) ??
        JSON.stringify([
          "host",
          report.hostId,
          account.provider,
          account.name,
          account.user,
          index,
        ]);
      const current = observations.get(key);
      const sources = current?.sources ?? new Set<string>();
      sources.add(report.hostLabel || report.hostId);
      const candidate = { accountId: key, account, report, sources };
      if (!current || observationIsNewer(candidate, current)) {
        observations.set(key, candidate);
      }
    }
  }
  return Array.from(observations.values(), (observation) => accountQuotaItem(observation, now));
}

function accountQuotaItem(
  { accountId, account, report, sources }: AccountObservation,
  now: number,
): MenuBarQuotaItem {
  const limited = account.windows.filter((window) => !window.unlimited);
  const remaining = limited.length
    ? percentage(Math.min(...limited.map((window) => window.remaining)))
    : null;
  const readAt = Date.parse(account.readAt);
  const cached =
    !Number.isFinite(readAt) || now - readAt > 300_000 || now - report.checkedAt > 120_000;
  let summary = account.balance || "暂无额度数据";
  if (account.windows.length > 0) summary = "不限额";
  if (remaining !== null) summary = `剩余 ${remaining}%`;
  if (account.error) summary = "额度读取失败";
  if (cached) summary += "（缓存）";
  const details = [
    `数据来源：${report.hostLabel || report.hostId}`,
    ...(sources.size > 1 ? [`关联主机：${Array.from(sources).join("、")}`] : []),
    account.plan,
  ].filter(Boolean);
  for (const window of account.windows) {
    details.push(
      `${window.name}：${window.unlimited ? "不限额" : `剩余 ${percentage(window.remaining)}%`}`,
    );
    if (window.resetsAt) details.push(`重置：${window.resetsAt}`);
  }
  if (account.readAt) details.push(`数据时间：${account.readAt}`);
  if (account.error) details.push("请在 Magpie 面板中刷新额度或检查账号登录。");
  const identity = maskQuotaIdentity(account.user);
  const title = [account.name || account.provider, identity].filter(Boolean).join(" · ");
  return {
    accountId,
    provider: account.provider.toLowerCase(),
    title,
    summary,
    details,
    remaining: account.error ? null : remaining,
    cached,
  };
}
