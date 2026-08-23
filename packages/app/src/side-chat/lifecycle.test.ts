import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearSideChatForParent,
  clearSideChatsForServer,
  closeSideChatPanel,
  openSideChatPanel,
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
  it("clears the owned fork when its parent agent closes", () => {
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

  it("destroys a fork whose open response arrives after the panel was closed", async () => {
    const opening = deferred<SideChatPayload>();
    const client = {
      openAgentSideChat: vi.fn(async () => opening.promise),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };
    const cleanup = effects();

    const open = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });
    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });
    opening.resolve(payload("side-a"));
    await open;

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();
    expect(cleanup.removeLocalAgent).toHaveBeenCalledWith("server", "side-a");
    expect(cleanup.clearProviderSubagents).toHaveBeenCalledWith("server", "side-a");
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
    const cleanup = effects();

    const openA = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });
    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });
    const openB = openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
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

  it("cleans up local state and destroys a ready fork on close", async () => {
    const client = {
      openAgentSideChat: vi.fn(async () => payload("side-a")),
      closeAgentSideChat: vi.fn(async () => payload("side-a")),
    };
    const cleanup = effects();
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });

    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();
    expect(cleanup.removeLocalAgent).toHaveBeenCalledWith("server", "side-a");
    expect(cleanup.clearProviderSubagents).toHaveBeenCalledWith("server", "side-a");
    expect(client.closeAgentSideChat).toHaveBeenCalledWith("parent", "side-a");
  });

  it("restores a ready fork when remote close fails so the same fork can be retried", async () => {
    const client = {
      openAgentSideChat: vi.fn(async () => payload("side-a")),
      closeAgentSideChat: vi
        .fn<DaemonClient["closeAgentSideChat"]>()
        .mockResolvedValueOnce({ ...payload("side-a"), error: "provider disposal failed" })
        .mockResolvedValueOnce(payload("side-a")),
    };
    const cleanup = effects();
    await openSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });

    await expect(
      closeSideChatPanel({
        key,
        serverId: "server",
        parentAgentId: "parent",
        client,
        effects: cleanup,
      }),
    ).rejects.toThrow("provider disposal failed");

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toMatchObject({
      status: "ready",
      sideAgentId: "side-a",
    });
    expect(cleanup.removeLocalAgent).not.toHaveBeenCalled();

    await closeSideChatPanel({
      key,
      serverId: "server",
      parentAgentId: "parent",
      client,
      effects: cleanup,
    });

    expect(selectSideChatPanel(useSideChatStore.getState(), key)).toBeNull();
    expect(client.closeAgentSideChat).toHaveBeenCalledTimes(2);
    expect(client.closeAgentSideChat).toHaveBeenNthCalledWith(1, "parent", "side-a");
    expect(client.closeAgentSideChat).toHaveBeenNthCalledWith(2, "parent", "side-a");
    expect(cleanup.removeLocalAgent).toHaveBeenCalledWith("server", "side-a");
    expect(cleanup.clearProviderSubagents).toHaveBeenCalledWith("server", "side-a");
  });

  it("clears only the disconnected server and removes local replicas for ready forks", () => {
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
});
