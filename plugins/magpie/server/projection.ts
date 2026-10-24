import { z } from "zod";
import { URL } from "node:url";
import { snapshotSchema, signInSchema, type Snapshot, type SignIn } from "../shared/magpie.js";
import { sourceOf, controlledMembers } from "./controls.js";

const text = z
  .string()
  .nullish()
  .transform((x) => x ?? "");
const login = z.object({
  user: text,
  plan: text,
  on: z.boolean().optional(),
  active: z.boolean().optional(),
  paused: z.boolean().optional(),
  lapsed: text,
});
const providerList = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      name: text,
      ready: z.boolean().optional(),
      off: z.boolean().optional(),
      exposed: z.number().int().nonnegative().default(0),
      account: z.object({ user: text, plan: text, logins: z.array(login).nullish() }).nullish(),
    }),
  ),
});
const groupList = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      name: text,
      members: z.array(z.string()),
      routing: text,
      affinity: text,
      ready: z.boolean().optional(),
      pick: z.string().optional(),
      memberInfo: z.array(z.object({ id: z.string(), ready: z.boolean().optional() })).nullish(),
    }),
  ),
});
const quotaList = z.object({
  data: z
    .array(
      z.object({
        provider: z.string(),
        name: text,
        user: text,
        plan: text,
        balance: text,
        readAt: text,
        error: text,
        windows: z
          .array(
            z.object({
              name: text,
              used: z.number(),
              remaining: z.number(),
              unlimited: z.boolean().optional(),
              resetsAt: text,
              display: text,
            }),
          )
          .nullish(),
      }),
    )
    .nullish(),
});

function projectAccounts(provider: z.infer<typeof providerList>["providers"][number]) {
  const account = provider.account;
  if (!account) return [];
  if (!account.logins?.length)
    return [{ user: account.user, plan: account.plan, enabled: !provider.off, needsLogin: false }];
  return account.logins.map((entry) => ({
    user: entry.user,
    plan: entry.plan,
    enabled: (entry.on === true || entry.active === true) && !entry.paused && !provider.off,
    needsLogin: !!entry.lapsed,
  }));
}

// Project fields explicitly: the upstream provider response also contains keys,
// authentication headers, and account internals that must stay on the daemon.
export function projectSnapshot(providers: unknown, groups: unknown, quotas: unknown): Snapshot {
  const ps = providerList.parse(providers).providers;
  const gs = groupList.parse(groups).groups;
  const qs = quotaList.parse(quotas).data ?? [];
  return snapshotSchema.parse({
    available: true,
    checkedAt: new Date().toISOString(),
    signIn: null,
    providers: ps.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      ready: p.ready === true && !p.off,
      modelCount: p.exposed,
      accounts: projectAccounts(p),
    })),
    groups: gs.map((g) => ({
      id: g.id,
      name: g.name || g.id,
      routing: g.routing || "smart",
      affinity: g.affinity || "auto",
      ready: g.ready === true,
      source: sourceOf(g),
      controllable: controlledMembers(g.members) !== null,
      ultraEnabled: false,
      members: g.members.map((id) => ({
        id,
        ready: g.memberInfo?.find((m) => m.id === id)?.ready === true,
      })),
    })),
    quotas: qs.map((q) => ({
      provider: q.provider,
      name: q.name,
      user: q.user,
      plan: q.plan,
      balance: q.balance,
      readAt: q.readAt,
      error: q.error ? "额度暂时无法读取，请稍后刷新。" : "",
      windows: (q.windows ?? []).map((w) =>
        Object.assign({}, w, { unlimited: w.unlimited === true }),
      ),
    })),
  });
}

export function allowedSignInUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      [
        "auth.openai.com",
        "claude.ai",
        "platform.claude.com",
        "console.anthropic.com",
        "platform.anthropic.com",
      ].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

export function projectSignIn(value: unknown): SignIn {
  const raw = z
    .object({
      id: z.string(),
      agent: z.enum(["codex", "claude"]),
      state: signInSchema.shape.state,
      url: text,
      code: z.string().optional(),
      pasteCallback: z.boolean().optional(),
      pasteCode: z.boolean().optional(),
      user: z.string().optional(),
      plan: z.string().optional(),
      error: text,
    })
    .parse(value);
  if (raw.url && !allowedSignInUrl(raw.url))
    throw new Error("Magpie 返回了无法识别的登录网址，请使用其终端登录。");
  return signInSchema.parse({
    ...raw,
    pasteCallback: raw.pasteCallback === true,
    pasteCode: raw.pasteCode === true,
    error: raw.error ? "登录未完成或已过期，请重新开始。" : undefined,
  });
}

export function validCallback(raw: string, flow: SignIn): boolean {
  if (raw.length > 16384) return false;
  try {
    const u = new URL(raw);
    return (
      flow.pasteCallback &&
      u.protocol === "http:" &&
      !u.username &&
      !u.password &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) &&
      !!u.searchParams.get("code") &&
      (flow.agent !== "codex" ||
        (u.port === "1455" && u.pathname === "/auth/callback" && !!u.searchParams.get("state")))
    );
  } catch {
    return flow.agent === "claude" && flow.pasteCode && /^[^\s#]+#[^\s#]+$/.test(raw);
  }
}
