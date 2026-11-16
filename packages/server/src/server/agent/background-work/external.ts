import { randomUUID } from "node:crypto";
import type { BackgroundWorkEntry, BackgroundWorkSnapshot } from "@getpaseo/plugin/server";
import type { AgentBackgroundWorkItemPayload } from "@getpaseo/protocol/messages";

interface Source {
  label: string;
  freshness: "loading" | "ready" | "stale" | "unavailable";
  observedAt: string | null;
  message: string;
  entries: BackgroundWorkEntry[];
  tokens: Map<string, string>;
  stop: (entry: BackgroundWorkEntry) => Promise<void>;
}

export interface BackgroundWorkSourceHost {
  open(
    id: string,
    label: string,
    stop: Source["stop"],
  ): {
    replace(snapshot: BackgroundWorkSnapshot): void;
    fail(): void;
    close(): void;
  };
}

export class ExternalBackgroundWork implements BackgroundWorkSourceHost {
  private readonly sources = new Map<string, Source>();

  hasSources(): boolean {
    return this.sources.size > 0;
  }

  constructor(private readonly changed: (agentIds: Set<string>, allAgents: boolean) => void) {}

  open(id: string, label: string, stop: Source["stop"]) {
    const previous = this.sources.get(id);
    const source: Source = {
      label,
      stop,
      freshness: "loading",
      observedAt: null,
      message: "Loading",
      entries: previous?.entries ?? [],
      tokens: new Map(),
    };
    this.sources.set(id, source);
    const publish = () => this.changed(new Set(source.entries.map((entry) => entry.agentId)), true);
    const current = () => this.sources.get(id) === source;
    publish();
    return {
      replace: (snapshot: BackgroundWorkSnapshot) => {
        if (!current()) return;
        if (snapshot.status === "unavailable") {
          const freshness = source.observedAt ? "stale" : "unavailable";
          if (source.freshness === freshness && source.message === snapshot.message) return;
          source.freshness = freshness;
          source.message = snapshot.message;
          source.tokens.clear();
          publish();
          return;
        }
        const allAgents = source.freshness !== "ready";
        const affected = new Set(source.entries.map((entry) => entry.agentId));
        const previousTokens = source.tokens;
        source.tokens = new Map();
        source.entries = snapshot.items;
        source.observedAt = snapshot.observedAt;
        source.freshness = "ready";
        for (const entry of source.entries) {
          affected.add(entry.agentId);
          const key = JSON.stringify([entry.agentId, entry.id]);
          if (entry.canStop) source.tokens.set(key, previousTokens.get(key) ?? randomUUID());
        }
        this.changed(affected, allAgents);
      },
      fail: () => {
        if (!current()) return;
        const freshness = source.observedAt ? "stale" : "unavailable";
        if (source.freshness === freshness && source.message === "Source unavailable; retrying")
          return;
        source.freshness = freshness;
        source.message = "Source unavailable; retrying";
        source.tokens.clear();
        publish();
      },
      close: () => {
        if (!current()) return;
        this.sources.delete(id);
        publish();
      },
    };
  }

  list(agentId: string): AgentBackgroundWorkItemPayload[] {
    const items: AgentBackgroundWorkItemPayload[] = [];
    for (const [id, source] of this.sources) {
      const metadata = {
        source: id,
        label: source.label,
        freshness: source.freshness,
        observedAt: source.observedAt,
      };
      for (const entry of source.entries) {
        if (entry.agentId !== agentId) continue;
        const stopToken = source.tokens.get(JSON.stringify([agentId, entry.id]));
        items.push({
          id: JSON.stringify([id, entry.id]),
          kind: entry.kind,
          description: entry.description,
          startedAt: entry.startedAt ?? "",
          canStop: Boolean(stopToken),
          stopToken,
          external: { ...entry.external, ...metadata },
        });
      }
      if (source.freshness !== "ready")
        items.push({
          id: JSON.stringify([id, null]),
          kind: "source",
          description: source.message,
          startedAt: "",
          external: {
            ...metadata,
            status: source.message,
            running: false,
            deadline: null,
            finishedAt: null,
            issue: null,
          },
        });
    }
    return items;
  }

  async stop(agentId: string, itemId: string, token: string): Promise<boolean> {
    for (const [id, source] of this.sources) {
      const entry = source.entries.find(
        (candidate) =>
          candidate.agentId === agentId && JSON.stringify([id, candidate.id]) === itemId,
      );
      if (!entry) continue;
      if (
        source.freshness !== "ready" ||
        source.tokens.get(JSON.stringify([agentId, entry.id])) !== token
      )
        throw new Error("Background source changed; refresh before cancelling");
      await source.stop(entry);
      return true;
    }
    return false;
  }
}
