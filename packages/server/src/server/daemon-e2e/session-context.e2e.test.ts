import { mkdtemp, readFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pino from "pino";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon, type TestPaseoDaemon } from "../test-utils/paseo-daemon.js";
import { AgentStorage, parseStoredAgentRecord } from "../agent/agent-storage.js";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { SessionContext } from "@getpaseo/protocol/session-context";

const clients: DaemonClient[] = [];
const daemons: TestPaseoDaemon[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const daemon of daemons.splice(0)) await daemon.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function start(root: string) {
  const daemon = await createTestPaseoDaemon({ paseoHomeRoot: root, cleanup: false });
  daemons.push(daemon);
  return daemon;
}
async function connect(daemon: TestPaseoDaemon, legacy = false) {
  const client = new DaemonClient({
    url: `ws://127.0.0.1:${daemon.port}/ws`,
    clientId: "same-logical-client",
    ...(legacy ? { capabilities: { [CLIENT_CAPS.ownedSubscriptions]: false } } : {}),
  });
  clients.push(client);
  await client.connect();
  await client.fetchAgents();
  return client;
}

test("context RPCs isolate subscribed sources, preserve execution identity, release and survive downgrade/restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-context-e2e-"));
  roots.push(root);
  const directory = path.join(root, "directory");
  await mkdir(directory);
  const daemon = await start(root);
  const modern = await connect(daemon);
  const legacy = await connect(daemon, true);
  expect(modern.getLastServerInfoMessage()?.features?.sessionContext).toBe(true);
  const workspace = (
    await modern.createWorkspace({ source: { kind: "directory", path: directory } })
  ).workspace;
  if (!workspace) throw new Error("Workspace missing");
  const now = "2026-01-01T00:00:00.000Z";
  const agent = parseStoredAgentRecord({
    id: "context-agent",
    provider: "codex",
    cwd: directory,
    workspaceId: workspace.id,
    createdAt: now,
    updatedAt: now,
    title: "Original",
  });
  await daemon.daemon.agentStorage.upsert(agent);
  const initial = await modern.getSessionContext(agent.id);
  expect(initial.context).toMatchObject({
    launchDirectory: directory,
    projectId: workspace.projectId,
  });
  const legacyTypes: string[] = [];
  legacy.subscribeRawMessages((message) => legacyTypes.push(message.type));
  const observation = modern.observeSessionContext(agent.id);
  await observation.ready;
  let resolveUpdate!: (context: SessionContext) => void;
  const updated = new Promise<SessionContext>((resolve) => {
    resolveUpdate = resolve;
  });
  const seen: SessionContext[] = [];
  observation.subscribe({
    snapshot: () => {},
    update: (message) => {
      if (message.type === "agent.context.update") {
        seen.push(message.payload.context);
        resolveUpdate(message.payload.context);
      }
    },
  });
  await modern.mutateSessionContext(agent.id, { kind: "project", projectId: null });
  expect(await updated).toMatchObject({ projectId: null });
  const linked = await modern.mutateSessionContext(agent.id, { kind: "link", path: root });
  expect(linked.context.linkedDirectories).toEqual([
    { path: root, source: "manual", addedAt: expect.any(String) },
  ]);
  await expect(
    modern.mutateSessionContext(agent.id, { kind: "unlink", path: directory }),
  ).rejects.toThrow("launch directory");
  await expect(modern.getSessionContext("missing-agent")).rejects.toThrow("Agent not found");
  expect(await daemon.daemon.agentStorage.get(agent.id)).toMatchObject({
    cwd: directory,
    workspaceId: workspace.id,
    title: "Original",
  });
  expect(
    (await modern.fetchWorkspaces()).entries.find((item) => item.id === workspace.id)?.projectId,
  ).toBe(workspace.projectId);
  await legacy.fetchAgents();
  expect(legacyTypes.filter((type) => type.startsWith("agent.context."))).toEqual([]);
  await observation.release();
  const count = seen.length;
  await modern.mutateSessionContext(agent.id, { kind: "pin", pinned: true });
  await modern.getSessionContext(agent.id);
  expect(seen).toHaveLength(count);
  const file = path.join(daemon.paseoHome, "agent-contexts", `${agent.id}.json`);
  const before = await readFile(file, "utf8");
  await modern.close();
  await legacy.close();
  clients.length = 0;
  await daemon.close();
  daemons.length = 0;
  // AgentStorage is unchanged by this feature: its stripping schema represents the old writer.
  const oldStorage = new AgentStorage(
    path.join(daemon.paseoHome, "agents"),
    pino({ level: "silent" }),
  );
  await oldStorage.initialize();
  const oldRecord = await oldStorage.get(agent.id);
  if (!oldRecord) throw new Error("Agent missing after stop");
  await oldStorage.upsert({ ...oldRecord, title: "Written by older daemon" });
  await oldStorage.flush();
  expect(await readFile(file, "utf8")).toBe(before);
  const restarted = await start(root);
  const reader = await connect(restarted);
  expect((await reader.getSessionContext(agent.id)).context).toEqual(JSON.parse(before));
  expect(await restarted.daemon.agentStorage.get(agent.id)).toMatchObject({
    title: "Written by older daemon",
    cwd: directory,
    workspaceId: workspace.id,
  });
}, 60_000);

test("first upgraded boot imports a fixed cohort before any legacy client can edit workspace metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "paseo-context-cohort-"));
  roots.push(root);
  const directory = path.join(root, "directory");
  await mkdir(directory);
  const oldHost = await start(root);
  const oldClient = await connect(oldHost, true);
  const workspace = (
    await oldClient.createWorkspace({ source: { kind: "directory", path: directory } })
  ).workspace;
  if (!workspace) throw new Error("Workspace missing");
  const pin = await oldClient.setWorkspacePinned(workspace.id, true);
  await oldClient.setWorkspaceLabel({
    workspaceId: workspace.id,
    label: { name: "Review", color: "sky" },
    assigned: true,
  });
  const now = "2026-01-01T00:00:00.000Z";
  const existing = parseStoredAgentRecord({
    id: "legacy-root",
    provider: "codex",
    cwd: directory,
    workspaceId: workspace.id,
    createdAt: now,
    updatedAt: now,
  });
  await oldHost.daemon.agentStorage.upsert(existing);
  await oldClient.close();
  clients.length = 0;
  await oldHost.close();
  daemons.length = 0;
  // This fixture represents the home before this feature's first upgraded boot.
  await rm(path.join(oldHost.paseoHome, "agent-contexts", ".legacy-import-complete"));
  const upgraded = await start(root);
  const legacy = await connect(upgraded, true);
  await legacy.setWorkspacePinned(workspace.id, false);
  await legacy.setWorkspaceLabel({
    workspaceId: workspace.id,
    label: { name: "Later", color: "red" },
    assigned: true,
  });
  const modern = await connect(upgraded);
  expect((await modern.getSessionContext(existing.id)).context).toMatchObject({
    pinnedAt: pin.pinnedAt,
    sidebarLabelNames: ["Review"],
  });
  await upgraded.daemon.agentStorage.upsert({ ...existing, id: "created-after-upgrade" });
  expect((await modern.getSessionContext("created-after-upgrade")).context).toMatchObject({
    projectId: workspace.projectId,
    pinnedAt: null,
    sidebarLabelNames: [],
  });
}, 60_000);
