import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { ConversationSurface } from "./switch";

const SURFACE_KEY_SEPARATOR = "\0";

interface ConversationSurfaceState {
  surfaceByAgentId: Record<string, ConversationSurface>;
  seenAgentIdsByServerId: Record<string, string[]>;
  leaseBlockedByKey: Record<string, true>;
  hasHydrated: boolean;
  setSurface: (serverId: string, agentId: string, surface: ConversationSurface) => void;
  pruneToAgentIds: (serverId: string, liveAgentIds: readonly string[]) => void;
  replaceLeaseBlocked: (serverId: string, agentIds: readonly string[]) => void;
  markHydrated: () => void;
}

const ConversationSurfacePersistedStateSchema = z.strictObject({
  surfaceByAgentId: z.record(z.string(), z.enum(["agent", "tui"])),
  seenAgentIdsByServerId: z.record(z.string(), z.array(z.string())).optional(),
});

export function conversationSurfaceKey(serverId: string, agentId: string): string {
  return `${serverId}${SURFACE_KEY_SEPARATOR}${agentId}`;
}

export function parseConversationSurfaceKey(
  key: string,
): { serverId: string; agentId: string } | null {
  const separator = key.indexOf(SURFACE_KEY_SEPARATOR);
  if (separator <= 0 || separator === key.length - 1) {
    return null;
  }
  return { serverId: key.slice(0, separator), agentId: key.slice(separator + 1) };
}

export function selectConversationSurface(
  state: Pick<ConversationSurfaceState, "surfaceByAgentId">,
  serverId: string | null,
  agentId: string | null,
): ConversationSurface {
  if (!agentId) {
    return "agent";
  }
  if (serverId) {
    const namespaced = state.surfaceByAgentId[conversationSurfaceKey(serverId, agentId)];
    if (namespaced) {
      return namespaced;
    }
  }
  return state.surfaceByAgentId[agentId] ?? "agent";
}

export function selectLeaseBlocked(
  state: Pick<ConversationSurfaceState, "leaseBlockedByKey">,
  serverId: string,
  agentId: string,
): boolean {
  return state.leaseBlockedByKey[conversationSurfaceKey(serverId, agentId)] === true;
}

export function removeSurfacesForAgentIds(
  surfaceByAgentId: Record<string, ConversationSurface>,
  deadAgentIds: readonly string[],
): Record<string, ConversationSurface> {
  if (deadAgentIds.length === 0) {
    return surfaceByAgentId;
  }
  const deadIds = new Set(deadAgentIds);
  let changed = false;
  const next: Record<string, ConversationSurface> = {};
  for (const [agentId, surface] of Object.entries(surfaceByAgentId)) {
    if (deadIds.has(agentId)) {
      changed = true;
      continue;
    }
    next[agentId] = surface;
  }
  return changed ? next : surfaceByAgentId;
}

export function pruneDeadSurfacesForServer(input: {
  serverId: string;
  surfaceByAgentId: Record<string, ConversationSurface>;
  seenAgentIds: readonly string[];
  liveAgentIds: readonly string[];
}): {
  surfaceByAgentId: Record<string, ConversationSurface>;
  seenAgentIds: string[];
} {
  const liveIds = new Set(input.liveAgentIds);
  const deadAgentIds = new Set(input.seenAgentIds.filter((agentId) => !liveIds.has(agentId)));
  const seenAgentIds = [...liveIds].sort();
  if (deadAgentIds.size === 0) {
    return { surfaceByAgentId: input.surfaceByAgentId, seenAgentIds };
  }

  let changed = false;
  const next: Record<string, ConversationSurface> = {};
  for (const [key, surface] of Object.entries(input.surfaceByAgentId)) {
    const parsed = parseConversationSurfaceKey(key);
    const isDead = parsed
      ? parsed.serverId === input.serverId && deadAgentIds.has(parsed.agentId)
      : deadAgentIds.has(key);
    if (isDead) {
      changed = true;
      continue;
    }
    next[key] = surface;
  }
  return {
    surfaceByAgentId: changed ? next : input.surfaceByAgentId,
    seenAgentIds,
  };
}

function replaceLeaseBlockedKeys(
  leaseBlockedByKey: Record<string, true>,
  serverId: string,
  agentIds: readonly string[],
): Record<string, true> {
  const next: Record<string, true> = {};
  for (const [key, value] of Object.entries(leaseBlockedByKey)) {
    const parsed = parseConversationSurfaceKey(key);
    if (parsed?.serverId === serverId) {
      continue;
    }
    next[key] = value;
  }
  for (const agentId of agentIds) {
    next[conversationSurfaceKey(serverId, agentId)] = true;
  }
  const previousKeys = Object.keys(leaseBlockedByKey).sort().join("\0");
  const nextKeys = Object.keys(next).sort().join("\0");
  return previousKeys === nextKeys ? leaseBlockedByKey : next;
}

export const useConversationSurfaceStore = create<ConversationSurfaceState>()(
  persist(
    (set) => ({
      surfaceByAgentId: {},
      seenAgentIdsByServerId: {},
      leaseBlockedByKey: {},
      hasHydrated: false,
      markHydrated: () => set((state) => (state.hasHydrated ? state : { hasHydrated: true })),
      setSurface: (serverId, agentId, surface) =>
        set((state) => {
          const key = conversationSurfaceKey(serverId, agentId);
          if (state.surfaceByAgentId[key] === surface && !(agentId in state.surfaceByAgentId)) {
            return state;
          }
          const surfaceByAgentId = {
            ...state.surfaceByAgentId,
            [key]: surface,
          };
          delete surfaceByAgentId[agentId];
          return { surfaceByAgentId };
        }),
      replaceLeaseBlocked: (serverId, agentIds) =>
        set((state) => {
          const leaseBlockedByKey = replaceLeaseBlockedKeys(
            state.leaseBlockedByKey,
            serverId,
            agentIds,
          );
          return leaseBlockedByKey === state.leaseBlockedByKey ? state : { leaseBlockedByKey };
        }),
      pruneToAgentIds: (serverId, liveAgentIds) =>
        set((state) => {
          const pruned = pruneDeadSurfacesForServer({
            serverId,
            surfaceByAgentId: state.surfaceByAgentId,
            seenAgentIds: state.seenAgentIdsByServerId[serverId] ?? [],
            liveAgentIds,
          });
          const seenUnchanged =
            (state.seenAgentIdsByServerId[serverId] ?? []).join("\0") ===
            pruned.seenAgentIds.join("\0");
          if (pruned.surfaceByAgentId === state.surfaceByAgentId && seenUnchanged) {
            return state;
          }
          return {
            surfaceByAgentId: pruned.surfaceByAgentId,
            seenAgentIdsByServerId: {
              ...state.seenAgentIdsByServerId,
              [serverId]: pruned.seenAgentIds,
            },
          };
        }),
    }),
    {
      name: "conversation-surface-state",
      version: 2,
      storage: createValidatedPersistStorage(AsyncStorage, ConversationSurfacePersistedStateSchema),
      partialize: (state) => ({
        surfaceByAgentId: state.surfaceByAgentId,
        seenAgentIdsByServerId: state.seenAgentIdsByServerId,
      }),
      merge: (persistedState, currentState) => {
        const result = ConversationSurfacePersistedStateSchema.safeParse(persistedState);
        return {
          ...currentState,
          surfaceByAgentId: result.success ? result.data.surfaceByAgentId : {},
          seenAgentIdsByServerId: result.success ? (result.data.seenAgentIdsByServerId ?? {}) : {},
        };
      },
      onRehydrateStorage: () => {
        return () => {
          useConversationSurfaceStore.getState().markHydrated();
        };
      },
    },
  ),
);
