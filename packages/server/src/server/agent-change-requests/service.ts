import type { Logger } from "pino";
import type { AgentChangeRequestsSnapshot } from "@getpaseo/protocol/messages";
import type { LinkedChangeRequest } from "@getpaseo/protocol/agent-change-requests";
import type { AgentManager } from "../agent/agent-manager.js";
import type { AgentPromptInput } from "../agent/agent-sdk-types.js";
import type { AgentStorage } from "../agent/agent-storage.js";
import type { ForgeResolver } from "../../services/forge-resolver.js";
import type { CurrentPullRequestStatus } from "../../services/forge-service.js";
import {
  defaultResolveRemoteUrl,
  ForgeAuthenticationError,
  ForgeCliMissingError,
  ForgeCommandError,
} from "../../services/forge-cli-command.js";
import {
  createdChangeRequest,
  isChangeRequestCreateCommand,
  parseChangeRequestUrl,
  type ChangeRequestIdentity,
} from "./identity.js";

type StatusItem = AgentChangeRequestsSnapshot["items"][number];
interface Poll {
  reference: LinkedChangeRequest;
  cwd: string;
  users: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  release?: () => void;
  errors: number;
  active: boolean;
}
interface Observation {
  agentId: string;
  listener: (snapshot: AgentChangeRequestsSnapshot) => void;
  releases: Map<string, () => void>;
  active: boolean;
}

export class AgentChangeRequests {
  private readonly cache = new Map<string, Omit<StatusItem, "reference">>();
  private readonly polls = new Map<string, Poll>();
  private readonly observations = new Set<Observation>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly stops: (() => void)[] = [];
  private disposed = false;
  private readonly remoteUrl: typeof defaultResolveRemoteUrl;
  private readonly executionCwd: string;

  constructor(
    private readonly storage: AgentStorage,
    private readonly resolver: ForgeResolver,
    private readonly logger: Logger,
    options: { resolveRemoteUrl?: typeof defaultResolveRemoteUrl; cwd?: string } = {},
  ) {
    this.remoteUrl = options.resolveRemoteUrl ?? defaultResolveRemoteUrl;
    this.executionCwd = options.cwd ?? process.cwd();
  }

  attach(manager: Pick<AgentManager, "subscribe" | "subscribeSubmittedPrompts">): void {
    this.stops.push(
      manager.subscribeSubmittedPrompts((agentId, prompt) =>
        this.track(this.attachments(agentId, prompt)),
      ),
    );
    this.stops.push(
      manager.subscribe(
        (event) => {
          if (event.type === "agent_removed") {
            this.removeAgent(event.agentId);
            return;
          }
          if (event.type !== "agent_stream" || event.event.type !== "timeline") return;
          const item = event.event.item;
          if (
            item.type !== "tool_call" ||
            item.status !== "completed" ||
            item.detail?.type !== "shell"
          )
            return;
          const detail = item.detail;
          if (detail.exitCode !== 0 || !isChangeRequestCreateCommand(detail.command)) return;
          this.track(
            (async () => {
              const record = await this.storage.get(event.agentId);
              if (!record || record.autoLinkChangeRequests === false) return;
              const remote = await this.remoteUrl(detail.cwd ?? record.cwd);
              const identity = createdChangeRequest(detail, remote);
              if (identity) await this.add(event.agentId, identity, "tool", item.callId);
            })(),
          );
        },
        { replayState: false, includeInternal: true },
      ),
    );
  }

  private track(operation: Promise<unknown>): void {
    const tracked = operation.catch((err) =>
      this.logger.warn({ err }, "Agent change request update failed"),
    );
    this.pending.add(tracked);
    void tracked.finally(() => this.pending.delete(tracked));
  }

  private removeAgent(agentId: string): void {
    for (const observation of this.observations) {
      if (observation.agentId !== agentId) continue;
      observation.active = false;
      for (const release of observation.releases.values()) release();
      observation.releases.clear();
      this.observations.delete(observation);
      observation.listener({ agentId, autoLink: true, items: [] });
    }
  }

  private async identity(url: string): Promise<ChangeRequestIdentity> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Paste a complete PR/MR URL");
    }
    // Parse a structurally bounded URL before any authenticated host probe.
    const possible = ["github", "gitlab", "tgit", "gitea"].some((forge) =>
      parseChangeRequestUrl(url, forge),
    );
    if (!possible) throw new Error("Unsupported PR/MR URL");
    const resolution = await this.resolver.resolveFromRemoteUrlAsync(
      `https://${parsed.host}/owner/repo`,
    );
    if (!resolution) throw new Error("Unsupported forge host; sign in with its forge CLI first");
    const identity = parseChangeRequestUrl(url, resolution.forge);
    if (!identity || identity.host !== resolution.host) throw new Error("Unsupported PR/MR URL");
    return identity;
  }

  private async attachments(agentId: string, prompt: AgentPromptInput): Promise<void> {
    if (typeof prompt === "string") return;
    const record = await this.storage.get(agentId);
    if (!record || record.autoLinkChangeRequests === false) return;
    for (const block of prompt) {
      if (block.type !== "forge_change_request") continue;
      let identity: ChangeRequestIdentity;
      try {
        identity = await this.identity(block.url);
      } catch {
        continue;
      }
      if (
        identity.forge !== block.forge ||
        identity.number !== block.number ||
        (block.projectPath &&
          identity.projectPath !==
            (identity.forge === "github" ? block.projectPath.toLowerCase() : block.projectPath))
      )
        continue;
      await this.add(agentId, identity, "attachment");
    }
  }

  private async add(
    agentId: string,
    identity: ChangeRequestIdentity,
    source: LinkedChangeRequest["source"],
    callId?: string,
  ): Promise<void> {
    await this.storage.mutateChangeRequests(agentId, (settings) => {
      const excluded = settings.excludedChangeRequestKeys ?? [];
      if (
        source !== "manual" &&
        (settings.autoLinkChangeRequests === false || excluded.includes(identity.key))
      )
        return settings;
      const items = settings.linkedChangeRequests ?? [];
      if (items.some((item) => item.key === identity.key)) return settings;
      if (items.length >= 100) throw new Error("A session can link at most 100 PRs/MRs");
      return {
        ...settings,
        linkedChangeRequests: [
          ...items,
          { ...identity, source, addedAt: new Date().toISOString(), ...(callId ? { callId } : {}) },
        ],
        excludedChangeRequestKeys: excluded.filter((key) => key !== identity.key),
      };
    });
    await this.changed(agentId);
  }

  async update(
    agentId: string,
    options: { addUrl?: string; removeKey?: string; autoLink?: boolean },
  ): Promise<AgentChangeRequestsSnapshot> {
    if (options.addUrl !== undefined)
      await this.add(agentId, await this.identity(options.addUrl.trim()), "manual");
    if (options.removeKey !== undefined || options.autoLink !== undefined) {
      await this.storage.mutateChangeRequests(agentId, (settings) => ({
        ...settings,
        ...(options.autoLink !== undefined ? { autoLinkChangeRequests: options.autoLink } : {}),
        ...(options.removeKey !== undefined
          ? {
              linkedChangeRequests: (settings.linkedChangeRequests ?? []).filter(
                (item) => item.key !== options.removeKey,
              ),
              excludedChangeRequestKeys: [
                ...new Set([...(settings.excludedChangeRequestKeys ?? []), options.removeKey]),
              ],
            }
          : {}),
      }));
      await this.changed(agentId);
    }
    return this.list(agentId);
  }

  async list(agentId: string): Promise<AgentChangeRequestsSnapshot> {
    const record = await this.storage.get(agentId);
    if (!record) throw new Error("Agent not found");
    const items: StatusItem[] = [];
    for (const reference of record.linkedChangeRequests ?? []) {
      const cached = this.cache.get(reference.key) ?? {
        status: null,
        availability: "pending",
        refreshedAt: null,
        stale: true,
      };
      items.push({ reference, ...cached });
    }
    return { agentId, autoLink: record.autoLinkChangeRequests !== false, items };
  }

  async subscribe(agentId: string, listener: Observation["listener"]): Promise<() => void> {
    if (this.disposed) throw new Error("Change request service is closed");
    await this.list(agentId);
    if (this.disposed) throw new Error("Change request service is closed");
    const observation: Observation = { agentId, listener, releases: new Map(), active: true };
    this.observations.add(observation);
    await this.reconcile(observation);
    return () => {
      observation.active = false;
      this.observations.delete(observation);
      for (const release of observation.releases.values()) release();
      observation.releases.clear();
    };
  }

  private async changed(agentId: string): Promise<void> {
    await Promise.all(
      [...this.observations]
        .filter((item) => item.agentId === agentId)
        .map((item) => this.reconcile(item)),
    );
  }

  private async reconcile(observation: Observation): Promise<void> {
    const record = await this.storage.get(observation.agentId);
    if (!observation.active || !record) return;
    const references = record.linkedChangeRequests ?? [];
    const keys = new Set(references.map((item) => item.key));
    for (const [key, release] of observation.releases) {
      if (!keys.has(key)) {
        release();
        observation.releases.delete(key);
      }
    }
    for (const reference of references) {
      if (observation.releases.has(reference.key)) continue;
      const notify = () => this.track(this.publish(observation));
      // Shared polls outlive any one checkout, so execute from a daemon-owned directory.
      observation.releases.set(reference.key, this.retain(reference, this.executionCwd, notify));
    }
    await this.publish(observation);
  }

  private async publish(observation: Observation): Promise<void> {
    const snapshot = await this.list(observation.agentId);
    if (observation.active) observation.listener(snapshot);
  }

  private retain(reference: LinkedChangeRequest, cwd: string, notify: () => void): () => void {
    let poll = this.polls.get(reference.key);
    if (!poll) {
      poll = { reference, cwd, users: new Set(), errors: 0, active: true };
      this.polls.set(reference.key, poll);
      this.track(this.refresh(poll));
    }
    poll.users.add(notify);
    const held = poll;
    return () => {
      held.users.delete(notify);
      if (held.users.size) return;
      held.active = false;
      if (held.timer) clearTimeout(held.timer);
      held.release?.();
      this.polls.delete(reference.key);
    };
  }

  private publishStatus(
    poll: Poll,
    status: CurrentPullRequestStatus | null,
    availability: string,
  ): void {
    if (!poll.active || this.disposed) return;
    if (status && availability === "available") {
      const identity = parseChangeRequestUrl(status.url, poll.reference.forge);
      if (identity?.key !== poll.reference.key) availability = "error";
    }
    const previous = this.cache.get(poll.reference.key);
    const success = availability === "available";
    this.cache.delete(poll.reference.key);
    let snapshot = previous?.status ?? null;
    if (success)
      snapshot = status
        ? { ...status, forge: poll.reference.forge, isDraft: status.isDraft ?? false }
        : null;
    this.cache.set(poll.reference.key, {
      status: snapshot,
      availability,
      refreshedAt: success ? new Date().toISOString() : (previous?.refreshedAt ?? null),
      stale: !success,
    });
    while (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value!);
    for (const notify of poll.users) notify();
  }

  private async refresh(poll: Poll): Promise<void> {
    try {
      const ref = poll.reference;
      const resolution = await this.resolver.resolveFromRemoteUrlAsync(
        `https://${ref.host}/${ref.projectPath}`,
      );
      if (!poll.active) return;
      if (
        !resolution ||
        resolution.forge !== ref.forge ||
        !resolution.service.getPullRequestStatus
      ) {
        this.publishStatus(poll, null, "unsupported");
      } else {
        const options = {
          cwd: poll.cwd,
          host: ref.host,
          projectPath: ref.projectPath,
          number: ref.number,
        };
        if (resolution.service.retainPullRequestStatusPoll) {
          const retained = resolution.service.retainPullRequestStatusPoll({
            ...options,
            onStatus: (status) => {
              poll.errors = 0;
              this.publishStatus(poll, status, status ? "available" : "not_found");
            },
            onError: (error) => this.failed(poll, error),
          });
          poll.release = retained.unsubscribe;
          return;
        }
        const status = await resolution.service.getPullRequestStatus(options);
        poll.errors = 0;
        this.publishStatus(poll, status, status ? "available" : "not_found");
      }
    } catch (error) {
      this.failed(poll, error);
    }
    if (!poll.active || this.disposed) return;
    const status = this.cache.get(poll.reference.key)?.status;
    let delay = 45_000;
    if (status && (status.isMerged || status.state.toLowerCase() === "closed")) delay = 300_000;
    if (poll.errors) delay = Math.min(300_000, 30_000 * 2 ** Math.min(poll.errors, 4));
    poll.timer = setTimeout(() => {
      this.track(this.refresh(poll));
    }, delay);
    poll.timer.unref?.();
  }

  private failed(poll: Poll, error: unknown): void {
    poll.errors++;
    const code = error && typeof error === "object" && "status" in error ? error.status : null;
    let availability = "error";
    if (error instanceof ForgeCliMissingError) availability = "cli_missing";
    else if (error instanceof ForgeAuthenticationError || code === 401)
      availability = "unauthenticated";
    else if (code === 403) availability = "forbidden";
    else if (code === 404) availability = "not_found";
    else if (error instanceof ForgeCommandError) {
      if (/\b404\b|\bnot found\b/i.test(error.stderr)) availability = "not_found";
      else if (/\b403\b|\bforbidden\b|resource not accessible/i.test(error.stderr))
        availability = "forbidden";
    }
    this.publishStatus(poll, null, availability);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const stop of this.stops) stop();
    for (const poll of this.polls.values()) {
      poll.active = false;
      if (poll.timer) clearTimeout(poll.timer);
      poll.release?.();
    }
    this.polls.clear();
    for (const observation of this.observations) observation.active = false;
    this.observations.clear();
    await Promise.allSettled(this.pending);
  }
}
