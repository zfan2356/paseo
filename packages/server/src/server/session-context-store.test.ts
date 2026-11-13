import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SessionContextStore } from "./session-context-store.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "./workspace-registry.js";
import { parseStoredAgentRecord } from "./agent/agent-storage.js";
import { createTestLogger } from "../test-utils/test-logger.js";
import { createWorkspaceLabelService } from "./workspace-labels/index.js";
import { writeJsonFileAtomic } from "./atomic-file.js";

const timestamp = "2026-01-01T00:00:00.000Z";
describe("session context", () => {
  let home: string;
  let workspaces: FileBackedWorkspaceRegistry;
  let contexts: SessionContextStore;
  function store() {
    return new SessionContextStore({
      directory: path.join(home, "agent-contexts"),
      getAgent: async (id) =>
        id === "missing"
          ? null
          : parseStoredAgentRecord({
              id,
              cwd: home,
              workspaceId: "workspace",
              provider: "codex",
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
      getWorkspace: (id) => workspaces.get(id),
      projectExists: async (id) => id === "other",
      isVisibleRoot: async (agent) => agent.id !== "child",
    });
  }
  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "paseo-context-"));
    workspaces = new FileBackedWorkspaceRegistry(
      path.join(home, "projects", "workspaces.json"),
      createTestLogger(),
    );
    await workspaces.upsert({
      ...createPersistedWorkspaceRecord({
        workspaceId: "workspace",
        projectId: "project",
        cwd: home,
        kind: "directory",
        displayName: "Workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
      pinnedAt: timestamp,
      labels: ["Review"],
    });
    contexts = store();
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  test("imports each visible root once; concurrent reads and replay preserve user edits", async () => {
    const [first, same, sibling, child] = await Promise.all([
      contexts.get("one"),
      contexts.get("one"),
      contexts.get("two"),
      contexts.get("child"),
    ]);
    expect(first).toEqual({
      agentId: "one",
      launchDirectory: home,
      projectId: "project",
      pinnedAt: timestamp,
      sidebarLabelNames: ["Review"],
      linkedDirectories: [],
      autoLinkDirectories: true,
      excludedDirectoryPaths: [],
    });
    expect(same).toEqual(first);
    expect(sibling).toEqual({ ...first, agentId: "two" });
    expect(child).toMatchObject({ pinnedAt: null, sidebarLabelNames: [] });
    await Promise.all([
      contexts.mutate("one", { kind: "project", projectId: "other" }),
      contexts.mutate("one", { kind: "pin", pinned: false }),
    ]);
    expect(await store().get("one")).toMatchObject({ projectId: "other", pinnedAt: null });
    expect(await workspaces.get("workspace")).toMatchObject({
      projectId: "project",
      pinnedAt: timestamp,
    });
    await expect(contexts.get("missing")).rejects.toThrow("Agent not found");
  });

  test("never overwrites malformed or unreadable side files", async () => {
    await mkdir(path.join(home, "agent-contexts"));
    const file = path.join(home, "agent-contexts", "one.json");
    await writeFile(file, "{broken");
    await expect(contexts.get("one")).rejects.toThrow();
    await expect(contexts.mutate("one", { kind: "pin", pinned: true })).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe("{broken");
    await rm(file);
    await mkdir(file);
    await expect(contexts.get("one")).rejects.toThrow();
  });

  test("validates manual links, deduplicates exact lexical paths, locks launch and enforces 32 including launch", async () => {
    const directory = path.join(home, "plain");
    await mkdir(directory);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        contexts.mutate("one", { kind: "link", path: path.join(directory, "..", "plain") }),
      ),
    );
    expect((await contexts.get("one")).linkedDirectories.map((item) => item.path)).toEqual([
      directory,
    ]);
    await expect(contexts.mutate("one", { kind: "unlink", path: home })).rejects.toThrow(
      "launch directory",
    );
    await expect(
      contexts.mutate("one", { kind: "link", path: path.join(home, "absent") }),
    ).rejects.toThrow();
    const file = path.join(home, "file");
    await writeFile(file, "x");
    await expect(contexts.mutate("one", { kind: "link", path: file })).rejects.toThrow(
      "Not a directory",
    );
    for (let i = 0; i < 30; i++) {
      const dir = path.join(home, String(i));
      await mkdir(dir);
      await contexts.mutate("one", { kind: "link", path: dir });
    }
    const last = path.join(home, "last");
    await mkdir(last);
    await expect(contexts.mutate("one", { kind: "link", path: last })).rejects.toThrow(
      "32 directories",
    );
    expect(
      (await contexts.mutate("one", { kind: "link", path: directory })).linkedDirectories,
    ).toHaveLength(31);
  });

  test("removing a worktree records exclusion; manual rebind clears it without altering files", async () => {
    const context = await contexts.get("one");
    const dir = path.join(home, "tree");
    await mkdir(dir);
    await contexts.writeUnlocked({
      ...context,
      linkedDirectories: [{ path: dir, source: "worktree", addedAt: timestamp }],
    });
    expect(await contexts.mutate("one", { kind: "unlink", path: dir })).toMatchObject({
      linkedDirectories: [],
      excludedDirectoryPaths: [dir],
    });
    expect(await contexts.mutate("one", { kind: "link", path: dir })).toMatchObject({
      linkedDirectories: [{ path: dir, source: "manual" }],
      excludedDirectoryPaths: [],
    });
  });

  test("shared catalog rename/delete updates independent session assignments atomically and publishes after commit", async () => {
    const labels = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: workspaces,
      sessionContexts: contexts,
    });
    await labels.setAssignment({
      workspaceId: "workspace",
      label: { name: "Review", color: "sky" },
      assigned: true,
    });
    await contexts.get("one");
    await contexts.get("two");
    await labels.setSessionAssignment({ agentId: "one", name: "review", assigned: false });
    const changes: string[][] = [];
    const subscription = await contexts.subscribe("two", (context) =>
      changes.push(context.sidebarLabelNames),
    );
    await labels.update({ name: "Review", newName: "Ready" });
    expect((await contexts.get("one")).sidebarLabelNames).toEqual([]);
    expect((await contexts.get("two")).sidebarLabelNames).toEqual(["Ready"]);
    expect(changes).toEqual([["Ready"]]);
    await labels.delete("Ready");
    expect((await contexts.get("two")).sidebarLabelNames).toEqual([]);
    subscription.unsubscribe();
    await contexts.mutate("two", { kind: "pin", pinned: false });
    expect(changes).toEqual([["Ready"], []]);
  });

  test("failed compound commit rolls back sessions, catalog and workspace; retry is safe", async () => {
    let fail = false;
    const labels = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: workspaces,
      sessionContexts: contexts,
      writeTransaction: async (file, value) => {
        if (
          fail &&
          typeof value === "object" &&
          value !== null &&
          "phase" in value &&
          value.phase === "committed"
        ) {
          fail = false;
          throw new Error("disk failed");
        }
        await writeJsonFileAtomic(file, value);
      },
    });
    await labels.setAssignment({
      workspaceId: "workspace",
      label: { name: "Review", color: "sky" },
      assigned: true,
    });
    await contexts.get("one");
    fail = true;
    await expect(labels.update({ name: "Review", newName: "Ready" })).rejects.toThrow(
      "disk failed",
    );
    expect((await contexts.get("one")).sidebarLabelNames).toEqual(["Review"]);
    expect((await labels.list()).labels).toEqual([{ name: "Review", color: "sky" }]);
    expect((await workspaces.get("workspace"))?.labels).toEqual(["Review"]);
    await labels.update({ name: "Review", newName: "Ready" });
    expect((await contexts.get("one")).sidebarLabelNames).toEqual(["Ready"]);
  });
});

describe("session label crash recovery", () => {
  test("a prepared journal restores context before-images on restart", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "paseo-context-recovery-"));
    try {
      const directory = path.join(home, "agent-contexts");
      const context = {
        agentId: "one",
        launchDirectory: home,
        projectId: null,
        pinnedAt: null,
        sidebarLabelNames: ["Review"],
        linkedDirectories: [],
        autoLinkDirectories: true,
        excludedDirectoryPaths: [],
      };
      const file = path.join(directory, "one.json");
      await writeJsonFileAtomic(file, { ...context, sidebarLabelNames: ["Ready"] });
      await writeJsonFileAtomic(path.join(home, "projects", "workspace-labels.json"), [
        { name: "Ready", color: "sky" },
      ]);
      await writeJsonFileAtomic(path.join(home, "projects", "workspace-labels.transaction.json"), {
        phase: "prepared",
        beforeLabels: [{ name: "Review", color: "sky" }],
        afterLabels: [{ name: "Ready", color: "sky" }],
        beforeWorkspaces: [],
        afterWorkspaces: [],
        beforeContexts: [context],
      });
      const registry = new FileBackedWorkspaceRegistry(
        path.join(home, "projects", "workspaces.json"),
        createTestLogger(),
      );
      const contexts = new SessionContextStore({
        directory,
        getAgent: async (id) =>
          parseStoredAgentRecord({
            id,
            cwd: home,
            provider: "codex",
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        getWorkspace: async () => null,
        isVisibleRoot: async () => true,
        projectExists: async () => false,
      });
      const labels = createWorkspaceLabelService({
        paseoHome: home,
        workspaceRegistry: registry,
        sessionContexts: contexts,
      });
      await labels.initialize();
      expect(await contexts.get("one")).toEqual(context);
      expect((await labels.list()).labels).toEqual([{ name: "Review", color: "sky" }]);
      await expect(
        readFile(path.join(home, "projects", "workspace-labels.transaction.json")),
      ).rejects.toThrow();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

test("a lost committed-marker acknowledgement blocks contexts until restart without replaying stale values", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "paseo-context-committed-"));
  try {
    const registryPath = path.join(home, "projects", "workspaces.json");
    let registry = new FileBackedWorkspaceRegistry(registryPath, createTestLogger());
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId: "workspace",
        projectId: "project",
        cwd: home,
        kind: "directory",
        displayName: "Workspace",
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    function makeContexts() {
      return new SessionContextStore({
        directory: path.join(home, "agent-contexts"),
        getAgent: async (id) =>
          parseStoredAgentRecord({
            id,
            cwd: home,
            workspaceId: "workspace",
            provider: "codex",
            createdAt: timestamp,
            updatedAt: timestamp,
          }),
        getWorkspace: (id) => registry.get(id),
        isVisibleRoot: async () => true,
        projectExists: async () => false,
      });
    }
    let contexts = makeContexts();
    let loseAck = false;
    const labels = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: registry,
      sessionContexts: contexts,
      writeTransaction: async (file, value) => {
        await writeJsonFileAtomic(file, value);
        if (
          loseAck &&
          typeof value === "object" &&
          value !== null &&
          "phase" in value &&
          value.phase === "committed"
        )
          throw new Error("lost acknowledgement");
      },
    });
    await labels.setAssignment({
      workspaceId: "workspace",
      label: { name: "Review", color: "sky" },
      assigned: true,
    });
    await contexts.get("one");
    loseAck = true;
    await expect(labels.update({ name: "Review", newName: "Ready" })).rejects.toThrow("uncertain");
    await expect(contexts.mutate("one", { kind: "pin", pinned: true })).rejects.toThrow(
      "uncertain",
    );
    registry = new FileBackedWorkspaceRegistry(registryPath, createTestLogger());
    contexts = makeContexts();
    const recovered = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: registry,
      sessionContexts: contexts,
    });
    await recovered.initialize();
    expect((await contexts.get("one")).sidebarLabelNames).toEqual(["Ready"]);
    const saved = await contexts.mutate("one", { kind: "pin", pinned: true });
    await createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: registry,
      sessionContexts: makeContexts(),
    }).initialize();
    expect(await contexts.get("one")).toEqual(saved);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a throwing observer cannot turn a durable context mutation into a failure", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "paseo-context-observer-"));
  try {
    const contexts = new SessionContextStore({
      directory: home,
      getAgent: async (id) =>
        parseStoredAgentRecord({
          id,
          cwd: home,
          provider: "codex",
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      getWorkspace: async () => null,
      isVisibleRoot: async () => true,
      projectExists: async () => false,
    });
    await contexts.subscribe("one", () => {
      throw new Error("Disconnected");
    });
    await expect(contexts.mutate("one", { kind: "pin", pinned: true })).resolves.toMatchObject({
      pinnedAt: expect.any(String),
    });
    expect((await contexts.get("one")).pinnedAt).toEqual(expect.any(String));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
