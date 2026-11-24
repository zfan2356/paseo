import { describe, expect, it, vi } from "vitest";
import { deriveMenuBarQuotaReport, fetchMenuBarQuota, withAntigravityUsage } from "./quotas";
import { menuBarQuotaItems } from "../../../../desktop/src/features/menu-bar/quotas";
import type { UsageReportEntry } from "@/usage/types";

const account = {
  provider: "codex",
  name: "ChatGPT",
  user: "person@example.com",
  plan: "Pro",
  balance: "",
  error: "",
  readAt: "2026-10-23T04:00:00Z",
  windows: [{ name: "5h", remaining: 72, unlimited: false, resetsAt: "2026-10-23T06:00:00Z" }],
};
describe("remote menu bar quotas", () => {
  const native: UsageReportEntry = {
    sourceId: "antigravity",
    sourceLabel: "Antigravity",
    id: "antigravity:profile",
    account: {},
    fetchedAt: account.readAt,
    report: {
      status: "available",
      windows: [
        { id: "gemini-wk", label: "Gemini · Weekly", remainingPct: 76.99, resetsAt: "2026-11-29" },
        { id: "gemini-5h", label: "Gemini · 5h", remainingPct: 97.9 },
        { id: "disabled", label: "Disabled", remainingPct: null },
      ],
    },
  };
  it.each(["not-configured", "unavailable", "ready"] as const)(
    "displays native windows with Magpie %s",
    (state) => {
      const host = {
        hostId: "remote",
        hostLabel: "test",
        checkedAt: 0,
        state,
        accounts: state === "ready" ? [account] : [],
      };
      const combined = withAntigravityUsage(host, [native, { ...native, sourceId: "codex" }]);
      const items = menuBarQuotaItems([combined], Date.parse(account.readAt));
      expect(items).toHaveLength(host.accounts.length + 1);
      expect(items.at(-1)).toMatchObject({
        title: "Antigravity",
        remaining: 77,
        cached: false,
        details: expect.arrayContaining([
          "Gemini · Weekly：剩余 77%",
          "重置：2026-11-29",
          "Gemini · 5h：剩余 97.9%",
        ]),
      });
      expect(items.at(-1)?.details.join(" ")).not.toContain("Disabled");
    },
  );
  it("keeps native account selection stable when the gateway accounts change", () => {
    const host = {
      hostId: "remote",
      hostLabel: "test",
      checkedAt: 0,
      state: "ready" as const,
      accounts: [],
    };
    const selected = (accounts: (typeof account)[]) =>
      menuBarQuotaItems([withAntigravityUsage({ ...host, accounts }, [native])], Date.now()).at(-1)
        ?.accountId;
    expect(selected([])).toBe(selected([account]));
  });
  it("strips credentials and non-quota data at both nesting levels", () => {
    const report = deriveMenuBarQuotaReport({
      hostId: "remote",
      hostLabel: "devcloud",
      now: 100,
      payload: {
        available: true,
        token: "secret",
        providers: [{ key: "secret" }],
        quotas: [
          {
            ...account,
            token: "secret",
            windows: [{ ...account.windows[0], key: "secret" }],
          },
        ],
      },
    });
    expect(report).toEqual({
      hostId: "remote",
      hostLabel: "devcloud",
      checkedAt: 100,
      state: "ready",
      accounts: [account],
    });
    expect(JSON.stringify(report)).not.toContain("secret");
  });
  it("discards cached accounts when the gateway is unavailable", () => {
    const report = deriveMenuBarQuotaReport({
      hostId: "remote",
      hostLabel: "devcloud",
      now: 100,
      payload: { available: false, quotas: [account] },
    });
    expect(report.accounts).toEqual([]);
    expect(report.state).toBe("unavailable");
  });
  it("distinguishes a missing plugin from RPC failure", async () => {
    const report = await fetchMenuBarQuota({
      hostId: "remote",
      hostLabel: "devcloud",
      client: {
        getPluginCatalog: async () => [],
        invokePluginRpc: async () => {
          throw new Error("Must not invoke");
        },
      },
    });
    expect(report.state).toBe("not-configured");
    const failure = await fetchMenuBarQuota({
      hostId: "remote",
      hostLabel: "devcloud",
      client: {
        getPluginCatalog: async () => {
          throw new Error("offline");
        },
        invokePluginRpc: async () => null,
      },
    });
    expect(failure.state).toBe("unavailable");
  });
  it("bounds a hung host request so another host can continue", async () => {
    vi.useFakeTimers();
    try {
      const result = fetchMenuBarQuota({
        hostId: "remote",
        hostLabel: "devcloud",
        client: {
          getPluginCatalog: () => new Promise(() => {}),
          invokePluginRpc: async () => null,
        },
      });
      await vi.advanceTimersByTimeAsync(25_000);
      expect((await result).state).toBe("unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});
