import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { WebSocket } from "ws";
import { WSSessionOutboundSchema, type SessionOutboundMessage } from "@getpaseo/protocol/messages";

import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const CREATED_AT = "2026-06-29T11:12:42.000Z";
const HEALTHY_UPDATED_AT = "2026-06-29T11:40:00.000Z";
const ORPHAN_ARCHIVED_AT = "2026-06-29T11:35:35.000Z";

interface StaleAgentFixture {
  healthyProjectId: string;
  healthyWorkspaceId: string;
  orphanWorkspaceId: string;
  healthyAgentId: string;
  orphanAgentId: string;
  paseoHomeRoot: string;
  cleanupPaths: string[];
}

test("agent fetch RPCs tolerate an agent whose workspace project record is gone", async () => {
  const fixture = seedStaleAgentFixture();
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;

  try {
    daemon = await createTestPaseoDaemon({ paseoHomeRoot: fixture.paseoHomeRoot, cleanup: false });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();

    const agents = await client.fetchAgents({
      requestId: "req-agent-rpc-list",
      filter: { includeArchived: true },
    });
    const history = await client.fetchAgentHistory({
      requestId: "req-agent-rpc-history",
    });
    const orphanAgent = await client.fetchAgent({
      requestId: "req-agent-rpc-detail",
      agentId: fixture.orphanAgentId,
    });

    expect(agents.entries.map(toAgentEntrySummary)).toEqual([healthyAgentSummary(fixture)]);
    expect(agents.pageInfo).toEqual({
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
    });
    expect(history.entries.map(toAgentEntrySummary)).toEqual([healthyAgentSummary(fixture)]);
    expect(history.pageInfo).toEqual({
      nextCursor: null,
      prevCursor: null,
      hasMore: false,
    });
    expect({
      agentId: orphanAgent?.agent.id,
      workspaceId: orphanAgent?.agent.workspaceId,
      archivedAt: orphanAgent?.agent.archivedAt,
      project: orphanAgent?.project,
    }).toEqual({
      agentId: fixture.orphanAgentId,
      workspaceId: fixture.orphanWorkspaceId,
      archivedAt: ORPHAN_ARCHIVED_AT,
      project: null,
    });
  } finally {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    for (const target of fixture.cleanupPaths) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

test("history search filters before pagination and keeps newest matches first", async () => {
  const fixture = seedStaleAgentFixture();
  let daemon: TestPaseoDaemon | null = null;
  let client: DaemonClient | null = null;
  try {
    const agentsDir = path.join(fixture.paseoHomeRoot, ".paseo", "agents");
    const template = JSON.parse(
      readFileSync(path.join(agentsDir, `${fixture.healthyAgentId}.json`), "utf8"),
    );
    for (const [id, title, updatedAt] of [
      ["newer-partial", "Unbilled usage", "2026-06-29T13:00:00.000Z"],
      ["unrelated", "Terminal resizing", "2026-06-29T12:00:00.000Z"],
      ["older-exact", "bill", "2026-06-28T12:00:00.000Z"],
    ]) {
      writeJson(path.join(agentsDir, `${id}.json`), {
        ...template,
        id,
        title,
        updatedAt,
        lastActivityAt: updatedAt,
      });
    }
    daemon = await createTestPaseoDaemon({ paseoHomeRoot: fixture.paseoHomeRoot, cleanup: false });
    client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws` });
    await client.connect();
    const first = await client.fetchAgentHistory({ search: "bill", page: { limit: 1 } });
    expect(first.entries.map((entry) => entry.agent.id)).toEqual(["newer-partial"]);
    expect(first.pageInfo.hasMore).toBe(true);
    expect(first.pageInfo.nextCursor).toBeTypeOf("string");
    const second = await client.fetchAgentHistory({
      search: "bill",
      page: { limit: 1, cursor: first.pageInfo.nextCursor! },
    });
    expect(second.entries.map((entry) => entry.agent.id)).toEqual(["older-exact"]);
    expect(second.pageInfo.hasMore).toBe(false);
    expect(second.entries[0].searchMatches).toBeUndefined();
  } finally {
    await client?.close().catch(() => undefined);
    await daemon?.close().catch(() => undefined);
    for (const target of fixture.cleanupPaths) rmSync(target, { recursive: true, force: true });
  }
});

function seedStaleAgentFixture(): StaleAgentFixture {
  const healthyCwd = mkdtempSync(path.join(os.tmpdir(), "paseo-healthy-agent-"));
  const orphanCwd = mkdtempSync(path.join(os.tmpdir(), "paseo-orphan-agent-"));
  const paseoHomeRoot = mkdtempSync(path.join(os.tmpdir(), "paseo-orphan-agent-home-"));
  const paseoHome = path.join(paseoHomeRoot, ".paseo");
  const projectsDir = path.join(paseoHome, "projects");
  const agentsDir = path.join(paseoHome, "agents");
  const healthyProjectId = "proj-healthy-agent-rpc";
  const healthyWorkspaceId = "ws-healthy-agent-rpc";
  const orphanWorkspaceId = "c:\\Users\\paseo\\stale-project";
  const orphanProjectId = "proj-removed-agent-rpc";
  const healthyAgentId = "agent-healthy-rpc";
  const orphanAgentId = "agent-orphan-rpc";

  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(agentsDir, { recursive: true });
  writeJson(path.join(projectsDir, "projects.json"), [
    {
      projectId: healthyProjectId,
      rootPath: healthyCwd,
      kind: "non_git",
      displayName: "healthy",
      customName: null,
      createdAt: CREATED_AT,
      updatedAt: HEALTHY_UPDATED_AT,
      archivedAt: null,
    },
  ]);
  writeJson(path.join(projectsDir, "workspaces.json"), [
    {
      workspaceId: healthyWorkspaceId,
      projectId: healthyProjectId,
      cwd: healthyCwd,
      kind: "directory",
      displayName: "healthy",
      title: null,
      branch: null,
      baseBranch: null,
      createdAt: CREATED_AT,
      updatedAt: HEALTHY_UPDATED_AT,
      archivedAt: null,
    },
    {
      workspaceId: orphanWorkspaceId,
      projectId: orphanProjectId,
      cwd: orphanCwd,
      kind: "directory",
      displayName: "stale project",
      title: null,
      branch: null,
      baseBranch: null,
      createdAt: CREATED_AT,
      updatedAt: ORPHAN_ARCHIVED_AT,
      archivedAt: ORPHAN_ARCHIVED_AT,
    },
  ]);
  writeJson(path.join(agentsDir, `${healthyAgentId}.json`), {
    id: healthyAgentId,
    provider: "codex",
    cwd: healthyCwd,
    workspaceId: healthyWorkspaceId,
    createdAt: CREATED_AT,
    updatedAt: HEALTHY_UPDATED_AT,
    lastActivityAt: HEALTHY_UPDATED_AT,
    lastUserMessageAt: null,
    title: "Healthy Agent",
    labels: {},
    lastStatus: "idle",
    lastModeId: "full-access",
    config: null,
    persistence: null,
  });
  writeJson(path.join(agentsDir, `${orphanAgentId}.json`), {
    id: orphanAgentId,
    provider: "codex",
    cwd: orphanCwd,
    workspaceId: orphanWorkspaceId,
    createdAt: CREATED_AT,
    updatedAt: ORPHAN_ARCHIVED_AT,
    lastActivityAt: ORPHAN_ARCHIVED_AT,
    lastUserMessageAt: null,
    title: "Orphaned Archived Agent",
    labels: {},
    lastStatus: "closed",
    lastModeId: "full-access",
    config: null,
    persistence: null,
    archivedAt: ORPHAN_ARCHIVED_AT,
  });

  return {
    healthyProjectId,
    healthyWorkspaceId,
    orphanWorkspaceId,
    healthyAgentId,
    orphanAgentId,
    paseoHomeRoot,
    cleanupPaths: [healthyCwd, orphanCwd, paseoHomeRoot],
  };
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

interface AgentDirectoryEntrySummaryInput {
  agent: {
    id: string;
    workspaceId?: string;
    archivedAt?: string | null;
  };
  project: {
    projectKey: string;
    projectName: string;
    workspaceName?: string | null;
  };
}

function healthyAgentSummary(fixture: StaleAgentFixture) {
  return {
    agentId: fixture.healthyAgentId,
    workspaceId: fixture.healthyWorkspaceId,
    archivedAt: null,
    projectKey: fixture.healthyProjectId,
    projectName: "healthy",
    workspaceName: "healthy",
  };
}

function toAgentEntrySummary(entry: AgentDirectoryEntrySummaryInput) {
  return {
    agentId: entry.agent.id,
    workspaceId: entry.agent.workspaceId,
    archivedAt: entry.agent.archivedAt ?? null,
    projectKey: entry.project.projectKey,
    projectName: entry.project.projectName,
    workspaceName: entry.project.workspaceName ?? null,
  };
}

// COMPAT(sessionChangeRequests): retired after v0.15.3; remove after 2027-05-17 once legacy clients are unsupported.
function legacyRequest(
  ws: WebSocket,
  frame: unknown,
  type: SessionOutboundMessage["type"],
): Promise<SessionOutboundMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Legacy RPC timed out"));
    }, 10000);
    function cleanup() {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("close", onClose);
    }
    function onClose() {
      cleanup();
      reject(new Error("Legacy connection closed"));
    }
    function onMessage(data: Buffer) {
      const parsed = WSSessionOutboundSchema.safeParse(JSON.parse(data.toString()));
      if (!parsed.success || parsed.data.message.type !== type) return;
      cleanup();
      resolve(parsed.data.message);
    }
    ws.on("message", onMessage);
    ws.once("close", onClose);
    ws.send(JSON.stringify(frame));
  });
}

test("retired session MR RPCs answer legacy clients without disconnecting or changing records", async () => {
  const fixture = seedStaleAgentFixture();
  let daemon: TestPaseoDaemon | null = null;
  let ws: WebSocket | null = null;
  try {
    daemon = await createTestPaseoDaemon({ paseoHomeRoot: fixture.paseoHomeRoot, cleanup: false });
    ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws!.once("open", resolve);
      ws!.once("error", reject);
    });
    const info = await legacyRequest(
      ws,
      {
        type: "hello",
        clientId: "retired-links-client",
        clientType: "cli",
        protocolVersion: 1,
        capabilities: { owned_subscriptions: true },
      },
      "status",
    );
    expect(info).toMatchObject({ type: "status", payload: { status: "server_info" } });
    expect(info).not.toHaveProperty("payload.features.agentChangeRequests", true);
    const agentsDir = path.join(daemon.paseoHome, "agents");
    const agentFile = path.join(
      agentsDir,
      readdirSync(agentsDir, { recursive: true, encoding: "utf8" }).find((file) =>
        file.endsWith(fixture.healthyAgentId + ".json"),
      )!,
    );
    const before = readFileSync(agentFile, "utf8");
    for (const operation of ["list", "update"]) {
      const response = await legacyRequest(
        ws,
        {
          type: "session",
          message: {
            type: `agent.change_requests.${operation}.request`,
            requestId: operation,
            agentId: fixture.healthyAgentId,
            addUrl: "https://github.com/acme/repo/pull/7",
            autoLink: true,
          },
        },
        operation === "list"
          ? "agent.change_requests.list.response"
          : "agent.change_requests.update.response",
      );
      expect(response).toEqual({
        type: `agent.change_requests.${operation}.response`,
        payload: {
          requestId: operation,
          snapshot: null,
          error: "Session PR/MR links are now provided by the Multica plugin.",
        },
      });
    }
    const subscription = await legacyRequest(
      ws,
      {
        type: "session",
        message: {
          type: "agent.change_requests.subscribe.request",
          requestId: "subscribe",
          agentIds: [fixture.healthyAgentId, "missing"],
        },
      },
      "agent.change_requests.subscribe.response",
    );
    if (subscription.type !== "agent.change_requests.subscribe.response")
      throw new Error("Missing subscription response");
    const released = await legacyRequest(
      ws,
      {
        type: "session",
        message: {
          type: "subscription.release.request",
          requestId: "release",
          subscriptionId: subscription.payload.subscriptionId,
        },
      },
      "subscription.release.response",
    );
    expect(released).toMatchObject({
      type: "subscription.release.response",
      payload: { requestId: "release" },
    });
    expect(readFileSync(agentFile, "utf8")).toBe(before);
    const detail = await legacyRequest(
      ws,
      {
        type: "session",
        message: {
          type: "fetch_agent_request",
          requestId: "after-retired-rpcs",
          agentId: fixture.healthyAgentId,
        },
      },
      "fetch_agent_response",
    );
    expect(detail).toMatchObject({
      type: "fetch_agent_response",
      payload: { agent: { id: fixture.healthyAgentId } },
    });
  } finally {
    ws?.terminate();
    await daemon?.close();
    for (const target of fixture.cleanupPaths) rmSync(target, { recursive: true, force: true });
  }
});
