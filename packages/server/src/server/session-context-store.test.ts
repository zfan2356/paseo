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
  function store(
    resolveAutomaticProject: (directory: string) => Promise<string | null> = async () => null,
  ) {
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
      resolveAutomaticProject,
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
    await contexts.initializeLegacy(["one", "two", "child"]);
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
      projectAssignment: "automatic",
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

  test("reclassifies only inherited legacy projects once and never overwrites manual choices", async () => {
    const original = await contexts.get("one");
    delete original.projectAssignment;
    await writeJsonFileAtomic(path.join(home, "agent-contexts", "one.json"), original);
    const automatic = store(async (directory) => {
      expect(directory).toBe(home);
      return "main-project";
    });
    expect(await automatic.get("one")).toEqual({
      ...original,
      projectId: "main-project",
      projectAssignment: "automatic",
    });
    expect(await store(async () => "changed").get("one")).toMatchObject({
      projectId: "main-project",
      projectAssignment: "automatic",
    });
    await automatic.mutate("one", { kind: "project", projectId: "other" });
    expect(await store(async () => "changed").get("one")).toMatchObject({
      projectId: "other",
      projectAssignment: "manual",
    });
    await automatic.mutate("one", { kind: "project", projectId: null });
    expect(await automatic.get("one")).toMatchObject({
      projectId: null,
      projectAssignment: "manual",
    });
    for (const projectId of [null, "different"]) {
      await writeJsonFileAtomic(path.join(home, "agent-contexts", "one.json"), {
        ...original,
        projectId,
      });
      expect(await automatic.get("one")).toEqual({ ...original, projectId });
    }
    await writeJsonFileAtomic(path.join(home, "agent-contexts", "one.json"), original);
    expect(await store().get("one")).toEqual(original);
    await workspaces.remove("workspace");
    expect(await automatic.get("one")).toEqual(original);
  });

  test("new automatic projects use launch-directory facts and retain non-Git defaults", async () => {
    const automatic = store(async () => "main-project");
    const created = await automatic.get("new-worktree-session");
    expect(created).toMatchObject({
      projectId: "main-project",
      projectAssignment: "automatic",
      launchDirectory: home,
    });
    await automatic.mutate(created.agentId, { kind: "link", path: path.dirname(home) });
    expect(await automatic.get(created.agentId)).toMatchObject({
      projectId: "main-project",
      launchDirectory: home,
    });
    expect(await store().get("new-non-git-session")).toMatchObject({
      projectId: "project",
      projectAssignment: "automatic",
    });
  });

  test("legacy import is fixed before clients connect; later workspace edits and new sessions stay independent", async () => {
    const existing = await contexts.get("one");
    await contexts.mutate("one", { kind: "pin", pinned: false });
    await workspaces.update("workspace", (workspace) => ({
      ...workspace,
      labels: ["Later"],
      pinnedAt: "2026-02-01T00:00:00.000Z",
    }));
    const fresh = await contexts.get("created-after-upgrade");
    expect(fresh).toMatchObject({ projectId: "project", pinnedAt: null, sidebarLabelNames: [] });
    await store().initializeLegacy(["one", "two", "created-after-upgrade"]);
    expect(await contexts.get("one")).toEqual({ ...existing, pinnedAt: null });
    expect((await contexts.get("two")).sidebarLabelNames).toEqual(["Review"]);
    expect(await contexts.get("created-after-upgrade")).toEqual(fresh);
    await rm(path.join(home, "agent-contexts", "two.json"));
    await store().initializeLegacy(["two"]);
    expect(await contexts.get("two")).toMatchObject({ pinnedAt: null, sidebarLabelNames: [] });
  });

  test("an interrupted legacy import retries missing records without overwriting initialized user values", async () => {
    const complete = path.join(home, "agent-contexts", ".legacy-import-complete");
    const two = path.join(home, "agent-contexts", "two.json");
    const saved = await readFile(two, "utf8");
    await rm(complete);
    await rm(path.join(home, "agent-contexts", "one.json"));
    await writeFile(two, "{broken");
    await expect(contexts.initializeLegacy(["one", "two"])).rejects.toThrow("context two");
    await expect(readFile(complete)).rejects.toThrow();
    await contexts.mutate("one", { kind: "pin", pinned: false });
    await writeFile(two, saved);
    await store().initializeLegacy(["one", "two"]);
    expect((await contexts.get("one")).pinnedAt).toBeNull();
    expect(await readFile(complete, "utf8")).toBe("complete\n");
  });

  test("ordinary workspace assignments and session assignments ignore unrelated corrupt contexts", async () => {
    const labels = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: workspaces,
      sessionContexts: contexts,
    });
    await writeFile(path.join(home, "agent-contexts", "broken.json"), "{broken");
    await expect(
      labels.setAssignment({
        workspaceId: "workspace",
        label: { name: "Review", color: "sky" },
        assigned: true,
      }),
    ).resolves.toMatchObject({ workspaceLabels: ["Review"] });
    await expect(
      labels.setSessionAssignment({ agentId: "one", name: "Review", assigned: false }),
    ).resolves.toMatchObject({ sidebarLabelNames: [] });
    await expect(
      labels.update({ name: "Review", newName: "Review", color: "red" }),
    ).resolves.toMatchObject({
      label: { name: "Review", color: "red" },
    });
    await expect(labels.update({ name: "Review", newName: "Ready" })).rejects.toThrow(
      "context broken",
    );
    await expect(labels.delete("Review")).rejects.toThrow("context broken");
    expect(await readFile(path.join(home, "agent-contexts", "broken.json"), "utf8")).toBe(
      "{broken",
    );
  });

  test("after downgrade rename/delete, unknown historical labels remain readable and removable", async () => {
    const oldLabels = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: workspaces,
    });
    await oldLabels.setAssignment({
      workspaceId: "workspace",
      label: { name: "Review", color: "sky" },
      assigned: true,
    });
    await oldLabels.update({ name: "Review", newName: "Ready" });
    expect((await contexts.get("one")).sidebarLabelNames).toEqual(["Review"]);
    const labels = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: workspaces,
      sessionContexts: contexts,
    });
    await expect(
      labels.setSessionAssignment({ agentId: "one", name: "review", assigned: false }),
    ).resolves.toMatchObject({ sidebarLabelNames: [] });
    await labels.setSessionAssignment({ agentId: "one", name: "Ready", assigned: true });
    await oldLabels.delete("Ready");
    const upgraded = createWorkspaceLabelService({
      paseoHome: home,
      workspaceRegistry: workspaces,
      sessionContexts: contexts,
    });
    expect((await contexts.get("one")).sidebarLabelNames).toEqual(["Ready"]);
    await expect(
      upgraded.setSessionAssignment({ agentId: "one", name: "Ready", assigned: false }),
    ).resolves.toMatchObject({ sidebarLabelNames: [] });
  });

  test("rejects relative directory links and removals instead of resolving daemon cwd", async () => {
    await expect(contexts.mutate("one", { kind: "link", path: "." })).rejects.toThrow(
      "must be absolute",
    );
    await expect(contexts.mutate("one", { kind: "unlink", path: "../repo" })).rejects.toThrow(
      "must be absolute",
    );
    expect((await contexts.get("one")).linkedDirectories).toEqual([]);
  });

  test("never overwrites malformed or unreadable side files", async () => {
    await mkdir(path.join(home, "agent-contexts"), { recursive: true });
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
        resolveAutomaticProject: async () => null,
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
        resolveAutomaticProject: async () => null,
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
    await contexts.initializeLegacy(["one"]);
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
      resolveAutomaticProject: async () => null,
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
