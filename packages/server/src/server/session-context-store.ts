import { promises as fs, constants } from "node:fs";
import path from "node:path";
import {
  SessionContextSchema,
  type SessionContext,
  type SessionContextMutation,
} from "@getpaseo/protocol/session-context";
import { workspaceLabelKey } from "@getpaseo/protocol/workspace-labels";
import { writeJsonFileAtomic } from "./atomic-file.js";
import type { StoredAgentRecord } from "./agent/agent-storage.js";
import type { PersistedWorkspaceRecord } from "./workspace-registry.js";

interface ContextDependencies {
  directory: string;
  getAgent(id: string): Promise<StoredAgentRecord | null>;
  getWorkspace(id: string): Promise<PersistedWorkspaceRecord | null>;
  isVisibleRoot(agent: StoredAgentRecord): Promise<boolean>;
  projectExists(id: string): Promise<boolean>;
}

/** One daemon-owned queue also makes catalog/assignment compound commits indivisible. */
export class SessionContextStore {
  private operations: Promise<unknown> = Promise.resolve();
  private blocked = false;
  private listeners = new Map<string, Set<(context: SessionContext) => void>>();
  constructor(private readonly deps: ContextDependencies) {}

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operations.then(() => {
      if (this.blocked)
        throw new Error("Session context storage uncertain; restart before retrying");
      return operation();
    });
    this.operations = next.catch(() => {});
    return next;
  }
  blockUntilRestart(): void {
    this.blocked = true;
  }

  get(agentId: string): Promise<SessionContext> {
    return this.exclusive(() => this.getUnlocked(agentId));
  }

  async getUnlocked(agentId: string): Promise<SessionContext> {
    const agent = await this.deps.getAgent(agentId);
    if (!agent) throw new Error("Agent not found");
    const existing = await this.read(agentId);
    if (existing) return existing;
    const workspace = agent.workspaceId ? await this.deps.getWorkspace(agent.workspaceId) : null;
    const migrate = await this.deps.isVisibleRoot(agent);
    // COMPAT(sessionContext): added in v0.13.0; remove legacy seeding after 2027-05-13.
    // File existence is the import marker, saved with the values in one atomic write.
    const context: SessionContext = {
      agentId,
      launchDirectory: path.resolve(agent.cwd),
      projectId: workspace?.projectId ?? null,
      pinnedAt: migrate ? (workspace?.pinnedAt ?? null) : null,
      sidebarLabelNames: migrate ? [...(workspace?.labels ?? [])] : [],
      linkedDirectories: [],
      autoLinkDirectories: true,
      excludedDirectoryPaths: [],
    };
    await this.writeUnlocked(context);
    return context;
  }

  async listStoredUnlocked(): Promise<SessionContext[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.deps.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const contexts: SessionContext[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const context = await this.read(entry.slice(0, -5));
      if (context) contexts.push(context);
    }
    return contexts;
  }

  async writeUnlocked(context: SessionContext): Promise<void> {
    SessionContextSchema.parse(context);
    await writeJsonFileAtomic(this.file(context.agentId), context);
  }

  publish(context: SessionContext): void {
    for (const listener of this.listeners.get(context.agentId) ?? [])
      listener(structuredClone(context));
  }

  subscribe(
    agentId: string,
    onChange: (context: SessionContext) => void,
  ): Promise<{ context: SessionContext; unsubscribe(): void }> {
    return this.exclusive(async () => {
      const context = await this.getUnlocked(agentId);
      const listeners = this.listeners.get(agentId) ?? new Set();
      listeners.add(onChange);
      this.listeners.set(agentId, listeners);
      return {
        context,
        unsubscribe: () => {
          listeners.delete(onChange);
          if (!listeners.size) this.listeners.delete(agentId);
        },
      };
    });
  }

  mutate(agentId: string, mutation: SessionContextMutation): Promise<SessionContext> {
    return this.exclusive(async () => {
      const context = await this.getUnlocked(agentId);
      switch (mutation.kind) {
        case "project":
          if (mutation.projectId !== null && !(await this.deps.projectExists(mutation.projectId)))
            throw new Error("Project not found");
          context.projectId = mutation.projectId;
          break;
        case "pin":
          context.pinnedAt = mutation.pinned
            ? (context.pinnedAt ?? new Date().toISOString())
            : null;
          break;
        case "label":
          throw new Error("Label assignments require a catalog transaction");
        case "auto_link":
          context.autoLinkDirectories = mutation.enabled;
          break;
        case "link": {
          const directory = path.resolve(mutation.path);
          if (!(await fs.stat(directory)).isDirectory()) throw new Error("Not a directory");
          await fs.access(directory, constants.R_OK | constants.X_OK);
          if (
            directory !== context.launchDirectory &&
            !context.linkedDirectories.some((item) => item.path === directory)
          ) {
            if (context.linkedDirectories.length >= 31)
              throw new Error("A session can have at most 32 directories");
            context.linkedDirectories.push({
              path: directory,
              source: "manual",
              addedAt: new Date().toISOString(),
            });
          }
          context.excludedDirectoryPaths = context.excludedDirectoryPaths.filter(
            (item) => item !== directory,
          );
          break;
        }
        case "unlink": {
          const directory = path.resolve(mutation.path);
          if (directory === context.launchDirectory)
            throw new Error("Cannot remove the launch directory");
          if (
            context.linkedDirectories.some(
              (item) => item.path === directory && item.source === "worktree",
            ) &&
            !context.excludedDirectoryPaths.includes(directory)
          )
            context.excludedDirectoryPaths.push(directory);
          context.linkedDirectories = context.linkedDirectories.filter(
            (item) => item.path !== directory,
          );
          break;
        }
      }
      await this.writeUnlocked(context);
      this.publish(context);
      return context;
    });
  }

  /** Catalog planners hold exclusive() while reading, staging and committing assignments. */
  rewriteLabels(contexts: readonly SessionContext[], from: string, to?: string): SessionContext[] {
    const updates: SessionContext[] = [];
    for (const context of contexts) {
      if (!context.sidebarLabelNames.some((name) => workspaceLabelKey(name) === from)) continue;
      const sidebarLabelNames = context.sidebarLabelNames.flatMap((name) => {
        if (workspaceLabelKey(name) !== from) return [name];
        return to ? [to] : [];
      });
      updates.push({ ...context, sidebarLabelNames });
    }
    return updates;
  }

  remove(agentId: string): Promise<void> {
    return this.exclusive(async () => {
      await fs.rm(this.file(agentId), { force: true });
    });
  }
  private file(agentId: string): string {
    if (
      !agentId ||
      path.basename(agentId) !== agentId ||
      agentId === "." ||
      agentId === ".." ||
      agentId.includes("\\")
    )
      throw new Error("Invalid agent ID");
    return path.join(this.deps.directory, `${agentId}.json`);
  }
  private async read(agentId: string): Promise<SessionContext | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.file(agentId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const context = SessionContextSchema.parse(JSON.parse(raw));
    if (context.agentId !== agentId) throw new Error("Session context identity mismatch");
    const directories = [
      context.launchDirectory,
      ...context.linkedDirectories.map((item) => item.path),
    ];
    if (
      directories.length > 32 ||
      new Set(directories).size !== directories.length ||
      directories.some(
        (directory) => !path.isAbsolute(directory) || path.resolve(directory) !== directory,
      )
    )
      throw new Error("Invalid stored session directories");
    return context;
  }
}
