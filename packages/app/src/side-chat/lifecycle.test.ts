import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSideChatForParent,
  clearSideChatsForServer,
  closeSideChatPanel,
  openSideChatPanel,
  restoreSideChatsForServer,
  showSideChatHistory,
  type SideChatLifecycleEffects,
} from "./lifecycle";
import { sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

type SideChatPayload = Awaited<ReturnType<DaemonClient["openAgentSideChat"]>>;

function payload(sideAgentId: string): SideChatPayload {
  return {
    requestId: "request",
    agentId: "parent",
    sideAgentId,
    response: null,
    error: null,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function effects(): SideChatLifecycleEffects & {
  removeLocalAgent: ReturnType<typeof vi.fn<(serverId: string, sideAgentId: string) => void>>;
  clearProviderSubagents: ReturnType<typeof vi.fn<(serverId: string, sideAgentId: string) => void>>;
} {
  return {
    removeLocalAgent: vi.fn<(serverId: string, sideAgentId: string) => void>(),
    clearProviderSubagents: vi.fn<(serverId: string, sideAgentId: string) => void>(),
  };
}

const key = "server\0parent";

afterEach(() => {
  useSideChatStore.setState({ panels: {} });
});

describe("side chat lifecycle", () => {
  it("clears only the local panel when its parent agent is deleted", () => {
    const cleanup = effects();
    useSideChatStore.getState().setPanel(sideChatKey("server", "parent"), {
      status: "ready",
      generation: 1,
      sideAgentId: "side-a",
    });
    useSideChatStore.getState().setPanel(sideChatKey("server", "other"), {
      status: "ready",
      generation: 2,
      sideAgentId: "side-b",
    });

    clearSideChatForParent("server", "parent", cleanup);

    expect(
      selectSideChatPanel(useSideChatStore.getState(), sideChatKey("server", "parent")),
    ).toBeNull();
    expect(
      selectSideChatPanel(useSideChatStore.getState(), sideChatKey("server", "other")),
    ).toMatchObject({
      status: "ready",
      sideAgentId: "side-b",
    });
    expect(cleanup.removeLocalAgent).toHaveBeenCalledWith("server", "side-a");
    expect(cleanup.clearProviderSubagents).toHaveBeenCalledWith("server", "side-a");
  });

  it("detaches a conversation whose open response arrives after the panel was closed", async () => {
    const opening = deferred<SideChatPayload>();
    const client = {
      openAgentSideChat: vi.fn(async () => opening.promise),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };

    const open = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    opening.resolve(payload("side-a"));
    await open;

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();

    expect(client.closeAgentSideChat).toHaveBeenCalledWith("parent", "side-a");
  });

  it("keeps a reopened fork when the previous open resolves late", async () => {
    const first = deferred<SideChatPayload>();
    const second = deferred<SideChatPayload>();
    const client = {
      openAgentSideChat: vi
        .fn<DaemonClient["openAgentSideChat"]>()
        .mockImplementationOnce(async () => first.promise)
        .mockImplementationOnce(async () => second.promise),
      closeAgentSideChat: vi.fn(async (_parentAgentId: string, sideAgentId: string) =>
        payload(sideAgentId),
      ),
    };

    const openA = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    const openB = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    second.resolve(payload("side-b"));
    await openB;
    first.resolve(payload("side-a"));
    await openA;

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "ready",
      sideAgentId: "side-b",
    });
    expect(client.closeAgentSideChat).toHaveBeenCalledTimes(1);
    expect(client.closeAgentSideChat).toHaveBeenCalledWith("parent", "side-a");
  });

  it("does not let a stale error replace a newer fork", async () => {
    const first = deferred<SideChatPayload>();
    const client = {
      openAgentSideChat: vi
        .fn<DaemonClient["openAgentSideChat"]>()
        .mockImplementationOnce(async () => first.promise)
        .mockResolvedValueOnce(payload("side-b")),
      closeAgentSideChat: vi.fn(async (_parentAgentId: string, sideAgentId: string) =>
        payload(sideAgentId),
      ),
    };

    const openA = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });
    first.reject(new Error("stale failure"));
    await openA;

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "ready",
      sideAgentId: "side-b",
    });
  });

  it("detaches a ready conversation without deleting its history on close", async () => {
    const client = {
      openAgentSideChat: vi.fn(async () => payload("side-a")),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });

    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();

    expect(client.closeAgentSideChat).toHaveBeenCalledWith("parent", "side-a");
  });

  it("keeps the panel closed even when detaching fails during a disconnect", async () => {
    const client = {
      openAgentSideChat: vi.fn(async () => payload("side-a")),
      closeAgentSideChat: vi
        .fn<DaemonClient["closeAgentSideChat"]>()
        .mockResolvedValueOnce({ ...payload("side-a"), error: "connection lost" })
        .mockResolvedValueOnce(payload("side-a")),
    };
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });

    await expect(
      closeSideChatPanel({
        key,
        serverId: "server",
        parentAgentId: "parent",
        client,
      }),
    ).rejects.toThrow("connection lost");

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();

    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
    });

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();
    expect(client.closeAgentSideChat).toHaveBeenCalledTimes(1);
    expect(client.closeAgentSideChat).toHaveBeenNthCalledWith(1, "parent", "side-a");
  });

  it("clears only the removed server and removes its local replicas", () => {
    const cleanup = effects();
    const openingKey = sideChatKey("server", "opening-parent");
    const readyKey = sideChatKey("server", "ready-parent");
    const errorKey = sideChatKey("server", "error-parent");
    const otherServerKey = sideChatKey("other-server", "parent");
    useSideChatStore.setState({
      panels: {
        [openingKey]: { status: "opening", generation: 1 },
        [readyKey]: { status: "ready", generation: 2, sideAgentId: "side-ready" },
        [errorKey]: { status: "error", generation: 3, error: "failed" },
        [otherServerKey]: { status: "ready", generation: 4, sideAgentId: "side-other" },
      },
    });

    clearSideChatsForServer("server", cleanup);

    expect(selectSideChatPanel(useSideChatStore.getState(), openingKey)).toBeNull();
    expect(selectSideChatPanel(useSideChatStore.getState(), readyKey)).toBeNull();
    expect(selectSideChatPanel(useSideChatStore.getState(), errorKey)).toBeNull();
    expect(selectSideChatPanel(useSideChatStore.getState(), otherServerKey)).toMatchObject({
      status: "ready",
      sideAgentId: "side-other",
    });
    expect(cleanup.removeLocalAgent).toHaveBeenCalledTimes(1);
    expect(cleanup.removeLocalAgent).toHaveBeenCalledWith("server", "side-ready");
    expect(cleanup.clearProviderSubagents).toHaveBeenCalledTimes(1);
    expect(cleanup.clearProviderSubagents).toHaveBeenCalledWith("server", "side-ready");
  });

  it("opens history without creating a conversation and reconnects only known identities", async () => {
    const client = {
      openAgentSideChat: vi
        .fn<DaemonClient["openAgentSideChat"]>()
        .mockResolvedValue(payload("side-a")),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };
    showSideChatHistory(key);
    await restoreSideChatsForServer("server", client);
    expect(selectSideChatPanel(useSideChatStore.getState(), key)?.status).toBe("history");
    expect(client.openAgentSideChat).not.toHaveBeenCalled();
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      sideAgentId: "side-a",
      client,
    });
    await restoreSideChatsForServer("other-server", client);
    expect(client.openAgentSideChat).toHaveBeenCalledTimes(1);
    await restoreSideChatsForServer("server", client);
    expect(client.openAgentSideChat.mock.calls).toEqual([
      ["parent", undefined, { sideAgentId: "side-a" }],
      ["parent", undefined, { sideAgentId: "side-a" }],
    ]);
    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "ready",
      sideAgentId: "side-a",
    });
  });

  it("retains a failed resume's identity instead of creating a replacement", async () => {
    const client = {
      openAgentSideChat: vi
        .fn<DaemonClient["openAgentSideChat"]>()
        .mockRejectedValueOnce(new Error("connection lost"))
        .mockResolvedValueOnce(payload("side-a")),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      sideAgentId: "side-a",
      client,
    });
    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "error",
      sideAgentId: "side-a",
    });
    await restoreSideChatsForServer("server", client);
    expect(client.openAgentSideChat).toHaveBeenLastCalledWith("parent", undefined, {
      sideAgentId: "side-a",
    });
    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "ready",
      sideAgentId: "side-a",
    });
  });

  it("does not detach a late resume when a newer resume opened the same conversation", async () => {
    const first = deferred<SideChatPayload>();
    const client = {
      openAgentSideChat: vi
        .fn<DaemonClient["openAgentSideChat"]>()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(payload("side-a")),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };
    const input = {
      key,
      serverId: "server",
      parentAgentId: "parent",
      sideAgentId: "side-a",
      client,
    };
    const opening = openSideChatPanel(input);
    await openSideChatPanel(input);
    first.resolve(payload("side-a"));
    await opening;
    expect(client.closeAgentSideChat).not.toHaveBeenCalled();

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "ready",
      sideAgentId: "side-a",
    });
  });
});
