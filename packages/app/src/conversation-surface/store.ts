import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { ConversationSurface } from "./switch";

interface ConversationSurfaceState {
  surfaceByAgentId: Record<string, ConversationSurface>;
  seenAgentIdsByServerId: Record<string, string[]>;
  hasHydrated: boolean;
  setSurface: (agentId: string, surface: ConversationSurface) => void;
  pruneToAgentIds: (serverId: string, liveAgentIds: readonly string[]) => void;
  markHydrated: () => void;
}

const ConversationSurfacePersistedStateSchema = z.strictObject({
  surfaceByAgentId: z.record(z.string(), z.enum(["agent", "tui"])),
});

export function selectConversationSurface(
  state: Pick<ConversationSurfaceState, "surfaceByAgentId">,
  agentId: string | null,
): ConversationSurface {
  if (!agentId) {
    return "agent";
  }
  return state.surfaceByAgentId[agentId] ?? "agent";
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
  surfaceByAgentId: Record<string, ConversationSurface>;
  seenAgentIds: readonly string[];
  liveAgentIds: readonly string[];
}): {
  surfaceByAgentId: Record<string, ConversationSurface>;
  seenAgentIds: string[];
} {
  const liveIds = new Set(input.liveAgentIds);
  const deadAgentIds = input.seenAgentIds.filter((agentId) => !liveIds.has(agentId));
  return {
    surfaceByAgentId: removeSurfacesForAgentIds(input.surfaceByAgentId, deadAgentIds),
    seenAgentIds: [...liveIds].sort(),
  };
}

export const useConversationSurfaceStore = create<ConversationSurfaceState>()(
  persist(
    (set) => ({
      surfaceByAgentId: {},
      seenAgentIdsByServerId: {},
      hasHydrated: false,
      markHydrated: () => set((state) => (state.hasHydrated ? state : { hasHydrated: true })),
      setSurface: (agentId, surface) =>
        set((state) => {
          if (state.surfaceByAgentId[agentId] === surface) {
            return state;
          }
          return {
            surfaceByAgentId: {
              ...state.surfaceByAgentId,
              [agentId]: surface,
            },
          };
        }),
      pruneToAgentIds: (serverId, liveAgentIds) =>
        set((state) => {
          const pruned = pruneDeadSurfacesForServer({
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
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, ConversationSurfacePersistedStateSchema),
      partialize: (state) => ({ surfaceByAgentId: state.surfaceByAgentId }),
      merge: (persistedState, currentState) => {
        const result = ConversationSurfacePersistedStateSchema.safeParse(persistedState);
        return {
          ...currentState,
          surfaceByAgentId: result.success ? result.data.surfaceByAgentId : {},
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
