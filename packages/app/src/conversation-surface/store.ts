import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { ConversationSurface } from "./switch";

interface ConversationSurfaceState {
  surfaceByAgentId: Record<string, ConversationSurface>;
  setSurface: (agentId: string, surface: ConversationSurface) => void;
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

export const useConversationSurfaceStore = create<ConversationSurfaceState>()(
  persist(
    (set) => ({
      surfaceByAgentId: {},
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
    },
  ),
);
