import { describe, expect, it } from "vitest";
import { menuBarQuotaItems, type MenuBarQuotaReport } from "./quotas.js";

const now = Date.parse("2026-10-23T04:00:00Z");
const report: MenuBarQuotaReport = {
  hostId: "remote",
  hostLabel: "devcloud",
  state: "ready",
  checkedAt: now,
  accounts: [
    {
      provider: "codex",
      name: "ChatGPT",
      user: "person@example.com",
      plan: "Pro",
      balance: "",
      error: "",
      readAt: new Date(now).toISOString(),
      windows: [
        { name: "5h", remaining: 75, unlimited: false, resetsAt: "later" },
        { name: "weekly", remaining: 24.123, unlimited: false, resetsAt: "" },
      ],
    },
  ],
};
describe("quota presentation", () => {
  it("shows the most constrained window, masks identity, and includes reset details", () => {
    const [item] = menuBarQuotaItems([report], now);
    expect(item.title).toBe("ChatGPT · p***@example.com");
    expect(item.summary).toBe("剩余 24.1%");
    expect(item.remaining).toBe(24.1);
    expect(item.cached).toBe(false);
    expect(item.details).toContain("重置：later");
  });
  it("marks stale data without pretending cached percentages are fresh", () => {
    const [item] = menuBarQuotaItems([report], now + 360_000);
    expect(item.cached).toBe(true);
    expect(item.summary).toBe("剩余 24.1%（缓存）");
  });
  it("does not show a percentage for failed or disconnected accounts", () => {
    const failed = { ...report, accounts: [{ ...report.accounts[0], error: "failed" }] };
    expect(menuBarQuotaItems([failed], now)[0].remaining).toBeNull();
    const offline = { ...report, state: "unavailable" as const };
    expect(menuBarQuotaItems([offline], now)).toEqual([]);
  });
  it("distinguishes unlimited, loading, and no configured plugin", () => {
    const unlimited = {
      ...report,
      accounts: [
        {
          ...report.accounts[0],
          windows: [{ name: "all", remaining: 0, unlimited: true, resetsAt: "" }],
        },
      ],
    };
    expect(menuBarQuotaItems([unlimited], now)[0].summary).toBe("不限额");
    expect(menuBarQuotaItems([{ ...report, state: "loading" }], now)).toEqual([]);
    expect(menuBarQuotaItems([{ ...report, state: "not-configured" }], now)).toEqual([]);
  });

  it("never displays a host placeholder beside real account quota cards", () => {
    const local = {
      ...report,
      hostId: "mac",
      hostLabel: "RUBICKYANG-MC0",
      state: "not-configured" as const,
      accounts: [],
    };
    const items = menuBarQuotaItems([local, report, { ...local, state: "ready" }], now);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("ChatGPT · p***@example.com");
    expect(JSON.stringify(items)).not.toContain("RUBICKYANG-MC0");
  });

  it("shows one quota per account across hosts without adding percentages", () => {
    const other = {
      ...report,
      hostId: "mac",
      hostLabel: "Mac",
      checkedAt: now + 1_000,
      accounts: [
        {
          ...report.accounts[0],
          readAt: new Date(now + 1_000).toISOString(),
          windows: [{ name: "weekly", remaining: 20, unlimited: false, resetsAt: "" }],
        },
      ],
    };
    for (const reports of [
      [report, other],
      [other, report],
    ]) {
      const items = menuBarQuotaItems(reports, now + 1_000);
      expect(items).toHaveLength(1);
      expect(items[0].summary).toBe("剩余 20%");
      expect(items[0].details).toContain("数据来源：Mac");
      expect(
        items[0].details.some(
          (line) =>
            line.startsWith("关联主机：") && line.includes("Mac") && line.includes("devcloud"),
        ),
      ).toBe(true);
    }
  });

  it("prefers valid account data over a newer failed observation", () => {
    const failed = {
      ...report,
      hostId: "mac",
      hostLabel: "Mac",
      checkedAt: now + 1_000,
      accounts: [
        {
          ...report.accounts[0],
          error: "failed",
          readAt: new Date(now + 1_000).toISOString(),
        },
      ],
    };
    expect(menuBarQuotaItems([report, failed], now + 1_000)).toHaveLength(1);
    expect(menuBarQuotaItems([report, failed], now + 1_000)[0].remaining).toBe(24.1);
  });

  it("uses the quota read time, not a later fetch of stale cached data", () => {
    const stale = {
      ...report,
      hostId: "mac",
      hostLabel: "Mac",
      checkedAt: now + 1_000,
      accounts: [
        {
          ...report.accounts[0],
          readAt: new Date(now - 360_000).toISOString(),
        },
      ],
    };
    expect(menuBarQuotaItems([report, stale], now + 1_000)[0].details).toContain(
      "数据来源：devcloud",
    );
  });

  it("keeps providers, distinct logins, and ambiguous identities separate", () => {
    for (const account of [
      { ...report.accounts[0], provider: "claude" },
      { ...report.accounts[0], user: "another@example.com" },
      { ...report.accounts[0], user: "p***@example.com" },
      { ...report.accounts[0], user: "" },
      { ...report.accounts[0], user: "当前账号" },
    ]) {
      const first = { ...report, accounts: [account] };
      const second = { ...first, hostId: "mac", hostLabel: "Mac" };
      const identified = !["", "当前账号", "p***@example.com"].includes(account.user);
      expect(menuBarQuotaItems([report, second], now)).toHaveLength(2);
      if (!identified) expect(menuBarQuotaItems([first, second], now)).toHaveLength(2);
    }
  });
});
