import type { PluginHandlerContext } from "./contracts.js";
import type { AgentExternalBackgroundWorkPayload } from "@getpaseo/protocol/messages";

export interface BackgroundWorkEntry {
  agentId: string;
  id: string;
  kind: string;
  description: string | null;
  startedAt: string | null;
  canStop: boolean;
  external: Omit<
    AgentExternalBackgroundWorkPayload,
    "source" | "label" | "freshness" | "observedAt"
  >;
}

export type BackgroundWorkSnapshot =
  | { status: "ready"; observedAt: string; items: BackgroundWorkEntry[] }
  | { status: "unavailable"; message: string };

/** Full host inventory. The daemon owns polling, fencing, aggregation and stop authorization. */
export interface BackgroundWorkSourceRegistration {
  id: string;
  label: string;
  fetch(context: PluginHandlerContext): Promise<BackgroundWorkSnapshot>;
  stop?(entry: BackgroundWorkEntry, context: PluginHandlerContext): Promise<void>;
}
