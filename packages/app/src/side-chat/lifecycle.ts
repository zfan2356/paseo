import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

import { useProviderSubagentStore } from "@/subagents/provider-store";
import { removeAgentDirectoryReplica } from "@/utils/agent-directory-sync";
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
  removeLocalAgent: removeAgentDirectoryReplica,
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

async function destroyRemoteSideChat(input: {
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
  client: SideChatLifecycleClient;
  effects?: SideChatLifecycleEffects;
}): Promise<void> {
  const generation = allocateGeneration();
  const effects = input.effects ?? DEFAULT_EFFECTS;
  useSideChatStore.getState().setPanel(input.key, { status: "opening", generation });

  try {
    const result = await input.client.openAgentSideChat(input.parentAgentId);
    if (result.error) {
      throw new Error(result.error);
    }
    if (!result.sideAgentId) {
      throw new Error("Daemon did not return a side chat agent");
    }

    const current = selectSideChatPanel(useSideChatStore.getState(), input.key);
    if (current?.generation !== generation) {
      cleanupLocalSideChat(effects, input.serverId, result.sideAgentId);
      await destroyRemoteSideChat({
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
    });
  }
}

export async function closeSideChatPanel(input: {
  key: string;
  serverId: string;
  parentAgentId: string;
  client: SideChatLifecycleClient | null;
  effects?: SideChatLifecycleEffects;
}): Promise<void> {
  const current = selectSideChatPanel(useSideChatStore.getState(), input.key);
  if (!current) return;

  // Remove first. This invalidates an in-flight open immediately and ensures
  // a subsequent open gets a strictly newer generation.
  useSideChatStore.getState().removePanel(input.key);
  if (current.status !== "ready") return;

  const effects = input.effects ?? DEFAULT_EFFECTS;
  if (!input.client) {
    cleanupLocalSideChat(effects, input.serverId, current.sideAgentId);
    return;
  }
  try {
    await destroyRemoteSideChat({
      client: input.client,
      parentAgentId: input.parentAgentId,
      sideAgentId: current.sideAgentId,
    });
    cleanupLocalSideChat(effects, input.serverId, current.sideAgentId);
  } catch (error) {
    // Restore only if the user has not already opened a newer fork. Keeping
    // the old replica makes the close action retryable with the same id.
    if (!selectSideChatPanel(useSideChatStore.getState(), input.key)) {
      useSideChatStore.getState().setPanel(input.key, current);
    }
    throw error;
  }
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
