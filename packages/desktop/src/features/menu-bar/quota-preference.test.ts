import { describe, expect, it } from "vitest";
import { menuBarQuotaBadge } from "./quota-preference";
import { menuBarQuotaItems, type MenuBarQuotaReport } from "./quotas";

const now = Date.parse("2026-10-23T06:00:00Z");
const account = (provider: string, user: string, remaining: number) => ({
  provider,
  user,
  name: provider,
  plan: "",
  balance: "",
  error: "",
  readAt: new Date(now).toISOString(),
  windows: [{ name: "weekly", remaining, unlimited: false, resetsAt: "" }],
});
const report: MenuBarQuotaReport = {
  hostId: "remote",
  hostLabel: "Remote",
  state: "ready",
  checkedAt: now,
  accounts: [
    account("cursor", "cursor@example.com", 99.8),
    account("codex", "codex@example.com", 65),
  ],
};
describe("menu bar quota badge", () => {
  it("defaults to Codex and follows the chosen account across hosts and ordering changes", () => {
    const items = menuBarQuotaItems([report], now);
    expect(menuBarQuotaBadge(items).title).toBe("65%");
    const preference = { accountId: items[0].accountId, display: "remaining" as const };
    const duplicate = { ...report, hostId: "mac", accounts: report.accounts.toReversed() };
    expect(menuBarQuotaBadge(menuBarQuotaItems([duplicate, report], now), preference).title).toBe(
      "99.8%",
    );
  });
  it("shows used percentage with one decimal and can hide the number", () => {
    const items = menuBarQuotaItems([report], now);
    expect(menuBarQuotaBadge(items, { accountId: items[0].accountId, display: "used" }).title).toBe(
      "0.2%",
    );
    expect(menuBarQuotaBadge(items, { accountId: null, display: "hidden" })).toEqual({
      title: "",
      summary: "",
    });
  });
  it("marks cached data and never switches a missing chosen account to another account", () => {
    const items = menuBarQuotaItems([report], now + 360_000);
    expect(menuBarQuotaBadge(items).title).toBe("~65%");
    const selected = { accountId: items[1].accountId, display: "remaining" as const };
    expect(menuBarQuotaBadge(items.slice(0, 1), selected).title).toBe("—%");
    const failed = menuBarQuotaItems(
      [{ ...report, accounts: [{ ...report.accounts[1], error: "expired" }] }],
      now,
    );
    expect(menuBarQuotaBadge(failed, selected).title).toBe("—%");
  });
  it("keeps unidentified accounts stable when unrelated hosts change order", () => {
    const anonymous = { ...report, accounts: [account("cursor", "", 50)] };
    const first = menuBarQuotaItems([anonymous, { ...report, hostId: "other" }], now);
    const second = menuBarQuotaItems([{ ...report, hostId: "other" }, anonymous], now);
    expect(first[0].accountId).toBe(second.find((item) => item.remaining === 50)?.accountId);
  });
});
