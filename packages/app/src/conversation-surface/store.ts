import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { ConversationSurface } from "./switch";

interface ConversationSurfaceState {
  surfaceByAgentId: Record<string, ConversationSurface>;
  hasHydrated: boolean;
  setSurface: (agentId: string, surface: ConversationSurface) => void;
  pruneToAgentIds: (liveAgentIds: readonly string[]) => void;
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

export function pruneSurfaceByAgentId(
  surfaceByAgentId: Record<string, ConversationSurface>,
  liveAgentIds: readonly string[],
): Record<string, ConversationSurface> {
  const liveIds = new Set(liveAgentIds);
  let changed = false;
  const next: Record<string, ConversationSurface> = {};
  for (const [agentId, surface] of Object.entries(surfaceByAgentId)) {
    if (!liveIds.has(agentId)) {
      changed = true;
      continue;
    }
    next[agentId] = surface;
  }
  return changed ? next : surfaceByAgentId;
}

export const useConversationSurfaceStore = create<ConversationSurfaceState>()(
  persist(
    (set) => ({
      surfaceByAgentId: {},
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
      pruneToAgentIds: (liveAgentIds) =>
        set((state) => {
          const surfaceByAgentId = pruneSurfaceByAgentId(state.surfaceByAgentId, liveAgentIds);
          return surfaceByAgentId === state.surfaceByAgentId ? state : { surfaceByAgentId };
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
