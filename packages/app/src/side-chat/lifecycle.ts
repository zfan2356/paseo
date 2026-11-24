import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { useProviderSubagentStore } from "@/subagents/provider-store";
import { AgentStoreProjection } from "@/runtime/directory-sync/internal/agent-store";
import { isSideChatKeyForServer, sideChatKey } from "./model";
import { selectSideChatPanel, useSideChatStore } from "./store";

export type SideChatLifecycleClient = Pick<
  DaemonClient,
  "openAgentSideChat" | "closeAgentSideChat"
>;

export interface SideChatLifecycleEffects {
  removeLocalAgent: (serverId: string, sideAgentId: string) => void;
  clearProviderSubagents: (serverId: string, sideAgentId: string) => void;
}

const DEFAULT_EFFECTS: SideChatLifecycleEffects = {
  removeLocalAgent: (serverId, sideAgentId) => {
    new AgentStoreProjection(serverId).remove(sideAgentId);
  },
  clearProviderSubagents: (serverId, sideAgentId) => {
    useProviderSubagentStore.getState().clearParent(serverId, sideAgentId);
  },
};

let nextSideChatGeneration = 0;

function allocateGeneration(): number {
  nextSideChatGeneration += 1;
  return nextSideChatGeneration;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanupLocalSideChat(
  effects: SideChatLifecycleEffects,
  serverId: string,
  sideAgentId: string,
): void {
  effects.removeLocalAgent(serverId, sideAgentId);
  effects.clearProviderSubagents(serverId, sideAgentId);
}

async function detachRemoteSideChat(input: {
  client: SideChatLifecycleClient;
  parentAgentId: string;
  sideAgentId: string;
}): Promise<void> {
  const result = await input.client.closeAgentSideChat(input.parentAgentId, input.sideAgentId);
  if (result.error) {
    throw new Error(result.error);
  }
}

export async function openSideChatPanel(input: {
  key: string;
  serverId: string;
  parentAgentId: string;
  sideAgentId?: string;
  client: SideChatLifecycleClient;
}): Promise<void> {
  const generation = allocateGeneration();
  useSideChatStore.getState().setPanel(input.key, {
    status: "opening",
    generation,
    sideAgentId: input.sideAgentId,
  });

  try {
    const result = input.sideAgentId
      ? await input.client.openAgentSideChat(input.parentAgentId, undefined, {
          sideAgentId: input.sideAgentId,
        })
      : await input.client.openAgentSideChat(input.parentAgentId);
    if (result.error) {
      throw new Error(result.error);
    }
    if (!result.sideAgentId) {
      throw new Error("Daemon did not return a side chat agent");
    }

    const current = selectSideChatPanel(useSideChatStore.getState(), input.key);
    if (current?.generation !== generation) {
      if (current && "sideAgentId" in current && current.sideAgentId === result.sideAgentId) return;
      await detachRemoteSideChat({
        client: input.client,
        parentAgentId: input.parentAgentId,
        sideAgentId: result.sideAgentId,
      });
      return;
    }

    useSideChatStore.getState().setPanel(input.key, {
      status: "ready",
      generation,
      sideAgentId: result.sideAgentId,
    });
  } catch (error) {
    const current = selectSideChatPanel(useSideChatStore.getState(), input.key);
    if (current?.generation !== generation) {
      return;
    }
    useSideChatStore.getState().setPanel(input.key, {
      status: "error",
      generation,
      error: errorMessage(error),
      sideAgentId: input.sideAgentId,
    });
  }
}

export async function closeSideChatPanel(input: {
  key: string;
  serverId: string;
  parentAgentId: string;
  client: SideChatLifecycleClient | null;
}): Promise<void> {
  const current = selectSideChatPanel(useSideChatStore.getState(), input.key);
  if (!current) return;

  useSideChatStore.getState().removePanel(input.key);
  if (current.status !== "ready") return;

  if (!input.client) return;
  await detachRemoteSideChat({
    client: input.client,
    parentAgentId: input.parentAgentId,
    sideAgentId: current.sideAgentId,
  });
}

export function showSideChatHistory(key: string): void {
  useSideChatStore
    .getState()
    .setPanel(key, { status: "history", generation: allocateGeneration() });
}

export async function restoreSideChatsForServer(
  serverId: string,
  client: SideChatLifecycleClient,
): Promise<void> {
  const entries = Object.entries(useSideChatStore.getState().panels);
  await Promise.all(
    entries.map(async ([key, panel]) => {
      if (
        !isSideChatKeyForServer(key, serverId) ||
        !panel ||
        !("sideAgentId" in panel) ||
        !panel.sideAgentId
      )
        return;
      await openSideChatPanel({
        key,
        serverId,
        parentAgentId: key.slice(serverId.length + 1),
        sideAgentId: panel.sideAgentId,
        client,
      });
    }),
  );
}

export function clearSideChatsForServer(
  serverId: string,
  effects: SideChatLifecycleEffects = DEFAULT_EFFECTS,
): void {
  const panels = useSideChatStore.getState().panels;
  for (const [key, panel] of Object.entries(panels)) {
    if (!isSideChatKeyForServer(key, serverId)) continue;
    useSideChatStore.getState().removePanel(key);
    if (panel?.status === "ready") {
      cleanupLocalSideChat(effects, serverId, panel.sideAgentId);
    }
  }
}

export function clearSideChatForParent(
  serverId: string,
  parentAgentId: string,
  effects: SideChatLifecycleEffects = DEFAULT_EFFECTS,
): void {
  const key = sideChatKey(serverId, parentAgentId);
  const panel = selectSideChatPanel(useSideChatStore.getState(), key);
  if (!panel) return;
  useSideChatStore.getState().removePanel(key);
  if (panel.status === "ready") {
    cleanupLocalSideChat(effects, serverId, panel.sideAgentId);
  }
}
