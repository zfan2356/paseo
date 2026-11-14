import { z } from "zod";
import {
  balanceToneFromRemaining,
  hashAccountKey,
  toneFromUsedPct,
  windowFromUsedPct,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
  type UsageWindow,
} from "@getpaseo/plugin/server/usage";
import { managementTransport, type Transport } from "./management.js";
import { inputSchema } from "../shared/input.js";

const magpieRouteSchema = z
  .object({ store: z.literal("magpie"), user: z.string().trim().min(1) })
  .strict();
export const usageInputSchema = z.union([
  inputSchema,
  z.object({ route: magpieRouteSchema }).strict(),
]);
type MagpieRoute = z.infer<typeof magpieRouteSchema>;

const providersSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      off: z.boolean().default(false),
      account: z
        .object({
          logins: z
            .array(
              z.object({
                user: z.string(),
                on: z.boolean().default(false),
                active: z.boolean().default(false),
                paused: z.boolean().default(false),
                lapsed: z.string().nullish(),
              }),
            )
            .default([]),
        })
        .nullish(),
    }),
  ),
});
const quotaSchema = z.object({
  provider: z.string(),
  user: z.string().default(""),
  plan: z.string().optional(),
  error: z.string().default(""),
  balance: z.string().default(""),
  windows: z
    .array(
      z.object({
        name: z.string(),
        used: z.number().finite(),
        resetsAt: z.iso.datetime({ offset: true }).nullish(),
        unlimited: z.boolean().default(false),
      }),
    )
    .nullish(),
});
const quotaListSchema = z.union([z.array(quotaSchema), z.object({ data: z.array(quotaSchema) })]);

function accountUser(user: string): string {
  return user.trim().toLowerCase();
}

function quotaWindow(
  window: NonNullable<z.infer<typeof quotaSchema>["windows"]>[number],
): UsageWindow {
  let id = `magpie-${hashAccountKey(window.name)}`;
  let label = window.name;
  let shortLabel = "";
  let summary = false;
  if (/^5\s*(h|hours?)$/i.test(window.name)) {
    id = "five_hour";
    label = "5 hours";
    shortLabel = "5h";
    summary = true;
  } else if (/^(7\s*days?|weekly)$/i.test(window.name)) {
    id = "weekly";
    label = "Weekly";
    shortLabel = "wk";
    summary = true;
  }
  const used = window.unlimited ? null : window.used;
  return windowFromUsedPct({
    id,
    label,
    shortLabel,
    summary,
    utilizationPct: used,
    resetsAt: window.resetsAt,
    tone: toneFromUsedPct(used),
  });
}

export class MagpieCodexUsage {
  private discovered = false;

  constructor(private readonly send: Transport = managementTransport()) {}

  async discover(scope: UsageScope, native: UsageAccount[]): Promise<UsageAccount[]> {
    if (scope.kind !== "global") return native;
    let providers: z.infer<typeof providersSchema>;
    try {
      providers = providersSchema.parse(await this.send("/api/providers"));
    } catch {
      if (this.discovered)
        throw new Error("Magpie account discovery failed; retry when the service is available.");
      return native;
    }
    const provider = providers.providers.find((entry) => entry.id === "codex");
    if (!provider || provider.off || !provider.account) {
      this.discovered = false;
      return native;
    }
    const accounts: UsageAccount[] = [];
    for (const login of provider.account.logins) {
      const enabled = (login.on || login.active) && !login.paused && !login.lapsed;
      const user = accountUser(login.user);
      if (!enabled || !user) continue;
      const matching = native.find(
        (account) => account.label && accountUser(account.label) === user,
      );
      accounts.push({
        key: matching ? matching.key : `magpie-${hashAccountKey(`codex:${user}`)}`,
        label: login.user,
        harness: "Magpie",
        input: { route: { store: "magpie", user: login.user } },
      });
    }
    this.discovered = accounts.length > 0;
    return [...accounts, ...native];
  }

  async fetch(route: MagpieRoute): Promise<UsageReport> {
    try {
      const path = `/api/usage/quotas/refresh?provider=codex&user=${encodeURIComponent(route.user)}`;
      const response = quotaListSchema.parse(await this.send(path, {}));
      const quotas = Array.isArray(response) ? response : response.data;
      const quota = quotas.find(
        (entry) =>
          entry.provider === "codex" && accountUser(entry.user) === accountUser(route.user),
      );
      if (!quota || quota.error)
        return {
          status: "error",
          error: "Magpie could not read this Codex account's usage. Check its sign-in and retry.",
        };
      const credits = /^(\d+(?:\.\d+)?)\s+credits?$/i.exec(quota.balance);
      const remaining = credits ? Number(credits[1]) : null;
      const balances =
        remaining === null
          ? []
          : [
              {
                id: "credits",
                label: "Credits",
                remaining,
                unit: "credits" as const,
                tone: balanceToneFromRemaining(remaining),
              },
            ];
      return {
        status: "available",
        planLabel: quota.plan,
        windows: (quota.windows ?? []).map(quotaWindow),
        balances,
        details: [],
      };
    } catch {
      return {
        status: "error",
        error: "Could not refresh Codex usage through Magpie. Check the service and retry.",
      };
    }
  }
}
