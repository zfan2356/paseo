// @vitest-environment jsdom

import { act, renderHook, cleanup } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { seedSessionHosts } from "@/test/seed-session";
import { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Agent } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { agentHistoryQueryKey, allAgentHistoryQueryKey } from "./agent-history-query-key";
import {
  useArchiveAgent,
  applyArchivedAgentCloseResults,
  isAgentArchiving,
  removeAgentFromListPayload,
  selectPendingArchiveAgentIds,
  setAgentArchiving,
} from "./use-archive-agent";

function captureArchiveError(error: unknown) {
  return error;
}

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    serverId: "server-a",
    id: "agent-1",
    provider: "codex",
    status: "running",
    createdAt: new Date("2026-04-01T03:00:00.000Z"),
    updatedAt: new Date("2026-04-01T03:00:00.000Z"),
    lastUserMessageAt: null,
    lastActivityAt: new Date("2026-04-01T03:00:00.000Z"),
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Agent 1",
    cwd: "/repo",
    model: null,
    parentAgentId: null,
    labels: {},
    archivedAt: null,
    ...overrides,
    turn: overrides.turn ?? { phase: "idle", cancellationRequestId: null },
  };
}

describe("useArchiveAgent", () => {
  afterEach(() => {
    cleanup();
    seedSessionHosts([]);
  });
  beforeEach(() => {
    useSessionStore.setState((state) => ({ ...state, sessions: {} }));
    seedSessionHosts(["server-a"]);
  });

  it("keeps agents and history active while pending, retries failures, and retains authoritative archive events", async () => {
    const client = new DaemonClient({ url: "ws://127.0.0.1:1", clientId: "archive-unit" });
    let response = Promise.withResolvers<{ archivedAt: string }>();
    client.archiveAgent = () => response.promise;
    const store = useSessionStore.getState();
    store.updateSessionClient("server-a", client);
    store.setAgents(
      "server-a",
      new Map([
        ["agent-1", makeAgent()],
        ["agent-2", makeAgent({ id: "agent-2" })],
      ]),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const history = { pages: [{ agents: [{ id: "agent-1", archivedAt: null }] }] };
    queryClient.setQueryData(agentHistoryQueryKey("server-a"), history);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(useArchiveAgent, { wrapper });
    const input = { serverId: "server-a", agentId: "agent-1" };
    let rejected: Promise<unknown> = Promise.resolve();
    await act(async () => {
      rejected = result.current.archiveAgent(input).catch(captureArchiveError);
      await Promise.resolve();
    });
    expect(isAgentArchiving({ queryClient, ...input })).toBe(true);
    expect(
      useSessionStore.getState().sessions["server-a"].agents.get("agent-1")?.archivedAt,
    ).toBeNull();
    expect(queryClient.getQueryData(agentHistoryQueryKey("server-a"))).toEqual(history);
    await act(async () => {
      response.reject(new Error("Archive rejected"));
      await rejected;
    });
    expect(isAgentArchiving({ queryClient, ...input })).toBe(false);
    expect(
      useSessionStore.getState().sessions["server-a"].agents.get("agent-1")?.archivedAt,
    ).toBeNull();
    response = Promise.withResolvers<{ archivedAt: string }>();
    let succeeded: Promise<void> = Promise.resolve();
    await act(async () => {
      succeeded = result.current.archiveAgent(input);
      await Promise.resolve();
    });
    await act(async () => {
      response.resolve({ archivedAt: "2026-04-01T04:00:00.000Z" });
      await succeeded;
    });
    expect(
      useSessionStore.getState().sessions["server-a"].agents.get("agent-1")?.archivedAt,
    ).toEqual(new Date("2026-04-01T04:00:00.000Z"));
    expect(queryClient.getQueryData(agentHistoryQueryKey("server-a"))).toEqual({
      pages: [{ agents: [{ id: "agent-1", archivedAt: new Date("2026-04-01T04:00:00.000Z") }] }],
    });
    response = Promise.withResolvers<{ archivedAt: string }>();
    await act(async () => {
      rejected = result.current
        .archiveAgent({ ...input, agentId: "agent-2" })
        .catch(captureArchiveError);
      await Promise.resolve();
    });
    act(() =>
      getHostRuntimeStore().archiveAgentSnapshot("server-a", "agent-2", "2026-04-01T05:00:00.000Z"),
    );
    await act(async () => {
      response.reject(new Error("Response lost after authority arrived"));
      await rejected;
    });
    expect(
      useSessionStore.getState().sessions["server-a"].agents.get("agent-2")?.archivedAt,
    ).toEqual(new Date("2026-04-01T05:00:00.000Z"));
  });

  it("tracks pending archive state in shared react-query cache", () => {
    const queryClient = new QueryClient();

    expect(
      isAgentArchiving({
        queryClient,
        serverId: "server-a",
        agentId: "agent-1",
      }),
    ).toBe(false);

    setAgentArchiving({
      queryClient,
      serverId: "server-a",
      agentId: "agent-1",
      isArchiving: true,
    });

    expect(
      isAgentArchiving({
        queryClient,
        serverId: "server-a",
        agentId: "agent-1",
      }),
    ).toBe(true);
    expect(
      isAgentArchiving({
        queryClient,
        serverId: "server-a",
        agentId: "agent-2",
      }),
    ).toBe(false);

    setAgentArchiving({
      queryClient,
      serverId: "server-a",
      agentId: "agent-1",
      isArchiving: false,
    });

    expect(
      isAgentArchiving({
        queryClient,
        serverId: "server-a",
        agentId: "agent-1",
      }),
    ).toBe(false);
  });

  it("selects pending archive ids for a single server", () => {
    const pendingIds = selectPendingArchiveAgentIds(
      {
        "server-a:agent-1": true,
        "server-a:agent-2": true,
        "server-b:agent-3": true,
      },
      "server-a",
    );

    expect(Array.from(pendingIds)).toEqual(["agent-1", "agent-2"]);
  });

  it("removes an archived agent from cached list payloads", () => {
    const payload = {
      entries: [{ agent: { id: "agent-1" } }, { agent: { id: "agent-2" } }],
      pageInfo: { hasMore: false },
    };

    const next = removeAgentFromListPayload(payload, "agent-1");

    expect(next.entries).toEqual([{ agent: { id: "agent-2" } }]);
    expect(next.pageInfo).toEqual({ hasMore: false });
  });

  it("applies archived agent close results to session state and cached lists", async () => {
    const queryClient = new QueryClient();
    useSessionStore.getState().initializeSession("server-a", {} as DaemonClient);
    useSessionStore.getState().setAgents("server-a", new Map([["agent-1", makeAgent()]]));
    queryClient.setQueryData(["sidebarAgentsList", "server-a"], {
      entries: [{ agent: { id: "agent-1" } }, { agent: { id: "agent-2" } }],
    });
    queryClient.setQueryData(["allAgents", "server-a"], {
      entries: [{ agent: { id: "agent-1" } }, { agent: { id: "agent-2" } }],
    });
    queryClient.setQueryData(agentHistoryQueryKey("server-a"), {
      pages: [
        {
          agents: [
            { id: "agent-1", archivedAt: null },
            { id: "agent-2", archivedAt: null },
          ],
        },
      ],
      pageParams: [null],
    });
    queryClient.setQueryData(allAgentHistoryQueryKey(["server-a", "server-b"]), {
      pages: [
        {
          agents: [
            { id: "agent-1", serverId: "server-a", archivedAt: null },
            { id: "agent-1", serverId: "server-b", archivedAt: null },
          ],
        },
      ],
      pageParams: [null],
    });

    applyArchivedAgentCloseResults({
      queryClient,
      serverId: "server-a",
      results: [{ agentId: "agent-1", archivedAt: "2026-04-01T04:00:00.000Z" }],
    });

    expect(
      useSessionStore
        .getState()
        .sessions["server-a"]?.agents.get("agent-1")
        ?.archivedAt?.toISOString(),
    ).toBe("2026-04-01T04:00:00.000Z");
    expect(queryClient.getQueryData(["sidebarAgentsList", "server-a"])).toEqual({
      entries: [{ agent: { id: "agent-2" } }],
    });
    expect(queryClient.getQueryData(["allAgents", "server-a"])).toEqual({
      entries: [{ agent: { id: "agent-2" } }],
    });
    expect(queryClient.getQueryData(agentHistoryQueryKey("server-a"))).toEqual({
      pages: [
        {
          agents: [
            { id: "agent-1", archivedAt: new Date("2026-04-01T04:00:00.000Z") },
            { id: "agent-2", archivedAt: null },
          ],
        },
      ],
      pageParams: [null],
    });
    expect(
      queryClient.getQueryState(allAgentHistoryQueryKey(["server-a", "server-b"]))?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryData(allAgentHistoryQueryKey(["server-a", "server-b"]))).toEqual({
      pages: [
        {
          agents: [
            {
              id: "agent-1",
              serverId: "server-a",
              archivedAt: new Date("2026-04-01T04:00:00.000Z"),
            },
            { id: "agent-1", serverId: "server-b", archivedAt: null },
          ],
        },
      ],
      pageParams: [null],
    });
  });

  it("can apply archived agent close results without invalidating cached lists", () => {
    const queryClient = new QueryClient();
    useSessionStore.getState().initializeSession("server-a", {} as DaemonClient);
    useSessionStore.getState().setAgents("server-a", new Map([["agent-1", makeAgent()]]));
    queryClient.setQueryData(["sidebarAgentsList", "server-a"], {
      entries: [{ agent: { id: "agent-1" } }, { agent: { id: "agent-2" } }],
    });
    queryClient.setQueryData(["allAgents", "server-a"], {
      entries: [{ agent: { id: "agent-1" } }, { agent: { id: "agent-2" } }],
    });
    queryClient.setQueryData(agentHistoryQueryKey("server-a"), {
      pages: [
        {
          agents: [{ id: "agent-1", archivedAt: null }],
        },
      ],
      pageParams: [null],
    });
    queryClient.setQueryData(allAgentHistoryQueryKey(["server-a"]), {
      pages: [{ agents: [{ id: "agent-1", serverId: "server-a", archivedAt: null }] }],
      pageParams: [null],
    });

    applyArchivedAgentCloseResults({
      queryClient,
      serverId: "server-a",
      results: [{ agentId: "agent-1", archivedAt: "2026-04-01T04:00:00.000Z" }],
      invalidateQueries: false,
    });

    expect(queryClient.getQueryState(["sidebarAgentsList", "server-a"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["allAgents", "server-a"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(agentHistoryQueryKey("server-a"))?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(allAgentHistoryQueryKey(["server-a"]))?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryData(agentHistoryQueryKey("server-a"))).toEqual({
      pages: [
        {
          agents: [{ id: "agent-1", archivedAt: new Date("2026-04-01T04:00:00.000Z") }],
        },
      ],
      pageParams: [null],
    });
    expect(queryClient.getQueryData(allAgentHistoryQueryKey(["server-a"]))).toEqual({
      pages: [
        {
          agents: [
            {
              id: "agent-1",
              serverId: "server-a",
              archivedAt: new Date("2026-04-01T04:00:00.000Z"),
            },
          ],
        },
      ],
      pageParams: [null],
    });
  });
});
