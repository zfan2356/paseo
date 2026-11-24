import { describe, expect, it, vi } from "vitest";
import { deriveMenuBarQuotaReport, fetchMenuBarQuota } from "./quotas";

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
