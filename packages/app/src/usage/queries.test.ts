import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { daemonConfigQueryKey } from "@/data/daemon-config";
import type { UsageReportEntry } from "./types";

const state = vi.hoisted(() => ({
  listUsageReports: vi.fn(),
  features: { usageSources: true } as Record<string, unknown>,
}));

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getClient: () => ({
      listUsageReports: state.listUsageReports,
      getLastServerInfoMessage: () => ({ features: state.features }),
    }),
  }),
  useHostRuntimeConnectionStatuses: vi.fn(),
  useHostRuntimeIsConnected: vi.fn(),
  useHosts: vi.fn(),
}));

import { refreshUsageSource, usageReportsQueryKey } from "./queries";

const antigravityEntry: UsageReportEntry = {
  id: "antigravity:profile",
  sourceId: "antigravity",
  sourceLabel: "Antigravity",
  account: {},
  fetchedAt: "2026-11-24T10:00:00Z",
  report: {
    status: "available",
    windows: [{ id: "wk", label: "Weekly", remainingPct: 80 }],
  },
};

describe("refreshUsageSource", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    state.features = { usageSources: true };
    queryClient = new QueryClient();
  });

  it("refreshes only cached report IDs for the requested source when already present", async () => {
    queryClient.setQueryData(usageReportsQueryKey("host"), [antigravityEntry]);
    const refreshed: UsageReportEntry = {
      ...antigravityEntry,
      fetchedAt: "2026-11-24T10:05:00Z",
    };
    state.listUsageReports.mockResolvedValue({ reports: [refreshed] });
    await refreshUsageSource(queryClient, "host", "antigravity");
    expect(state.listUsageReports).toHaveBeenCalledWith({
      reportIds: ["antigravity:profile"],
      forceRefresh: true,
    });
    expect(queryClient.getQueryData(usageReportsQueryKey("host"))).toEqual([refreshed]);
  });

  it("re-discovers reports when the requested source is not cached yet", async () => {
    state.listUsageReports.mockImplementation(async (_opts, onReport) => {
      onReport?.(antigravityEntry);
      return { reports: [antigravityEntry] };
    });
    await refreshUsageSource(queryClient, "host", "antigravity");
    expect(state.listUsageReports).toHaveBeenCalledWith(
      { agentId: undefined, forceRefresh: true },
      expect.any(Function),
    );
    expect(queryClient.getQueryData(usageReportsQueryKey("host"))).toEqual([antigravityEntry]);
  });

  it("throws when a newly discovered report for the source is unavailable", async () => {
    const unavailable: UsageReportEntry = {
      ...antigravityEntry,
      report: { status: "unavailable", problem: { kind: "no_quota", detail: "Sign in" } },
    };
    state.listUsageReports.mockResolvedValue({ reports: [unavailable] });
    await expect(refreshUsageSource(queryClient, "host", "antigravity")).rejects.toThrow(
      "Antigravity 额度刷新失败",
    );
  });

  it("skips discovery when usage reports are disabled or unsupported", async () => {
    queryClient.setQueryData(daemonConfigQueryKey("host"), { usage: { enabled: false } });
    await refreshUsageSource(queryClient, "host", "antigravity");
    expect(state.listUsageReports).not.toHaveBeenCalled();

    queryClient.removeQueries({ queryKey: daemonConfigQueryKey("host") });
    state.features = {};
    await refreshUsageSource(queryClient, "host", "antigravity");
    expect(state.listUsageReports).not.toHaveBeenCalled();
  });
});
