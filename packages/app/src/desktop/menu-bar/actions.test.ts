import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  online: true,
  invoke: vi.fn(),
  catalog: vi.fn(),
  nativeRefresh: vi.fn(),
  setQueryData: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({ router: { push: state.push } }));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({
    getHosts: () => [{ serverId: "host", label: "devcloud" }],
    getClient: () => ({ invokePluginRpc: state.invoke, getPluginCatalog: state.catalog }),
    getSnapshot: () => ({ connectionStatus: state.online ? "online" : "offline" }),
  }),
}));
vi.mock("@/data/query-client", () => ({ queryClient: { setQueryData: state.setQueryData } }));
vi.mock("@/usage/queries", () => ({ refreshUsageSource: state.nativeRefresh }));

import { executeMagpieAction } from "./actions.electron";

describe("Magpie board actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.online = true;
    state.invoke.mockResolvedValue({
      available: true,
      quotas: [],
      groups: [],
      speedControlReady: true,
    });
  });

  it("changes only the selected model's source on the selected host", async () => {
    await executeMagpieAction({
      kind: "source",
      hostId: "host",
      groupId: "gpt-6-astra",
      source: "personal",
    });
    expect(state.invoke).toHaveBeenCalledWith("magpie", "magpie.source.set", {
      groupId: "gpt-6-astra",
      source: "personal",
    });
    expect(state.setQueryData).toHaveBeenCalledWith(
      ["menu-bar", "magpie-quotas", "host", "online"],
      expect.objectContaining({ hostId: "host", state: "ready" }),
    );
  });

  it("sends the requested Ultra fast value without altering source", async () => {
    await executeMagpieAction({
      kind: "ultra",
      hostId: "host",
      groupId: "gpt-6-astra",
      enabled: true,
    });
    expect(state.invoke).toHaveBeenCalledExactlyOnceWith("magpie", "magpie.ultra.set", {
      groupId: "gpt-6-astra",
      enabled: true,
    });
  });

  it("surfaces a server rejection and does not optimistically change the display", async () => {
    state.invoke.mockRejectedValue(new Error("Personal account unavailable"));
    await expect(
      executeMagpieAction({
        kind: "ultra",
        hostId: "host",
        groupId: "gpt-6-astra",
        enabled: true,
      }),
    ).rejects.toThrow("Personal account unavailable");
    expect(state.setQueryData).not.toHaveBeenCalled();
  });

  it("opens the selected host's login surface without invoking a settings mutation", async () => {
    await executeMagpieAction({ kind: "magpie", hostId: "host" });
    expect(state.push).toHaveBeenCalledWith("/h/host/plugin/magpie/surface/main");
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("refreshes native usage on a host without Magpie", async () => {
    state.catalog.mockResolvedValue([]);
    await executeMagpieAction({ kind: "refresh", hostId: "host" });
    expect(state.nativeRefresh).toHaveBeenCalledWith(expect.anything(), "host", "antigravity");
    expect(state.invoke).not.toHaveBeenCalled();
  });

  it("reports both failures when Magpie and native usage refresh both fail", async () => {
    state.catalog.mockResolvedValue([{ id: "magpie" }]);
    state.invoke.mockResolvedValue({ available: false, quotas: [] });
    state.nativeRefresh.mockRejectedValue(new Error("Antigravity 额度刷新失败"));
    await expect(executeMagpieAction({ kind: "refresh", hostId: "host" })).rejects.toThrow(
      "Magpie 网关不可用，请打开账号管理检查服务。；Antigravity 额度刷新失败",
    );
  });

  it("rejects offline and unknown hosts before invoking any RPC", async () => {
    state.online = false;
    await expect(executeMagpieAction({ kind: "refresh", hostId: "host" })).rejects.toThrow(
      "主机未连接",
    );
    state.online = true;
    await expect(executeMagpieAction({ kind: "refresh", hostId: "unknown" })).rejects.toThrow(
      "主机未连接",
    );
    expect(state.invoke).not.toHaveBeenCalled();
  });
});
