import { mergeLegacySessionPins, type LegacySessionPin } from "./model";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
const PreferencesSchema = z.object({
  expanded: z.record(z.string(), z.boolean()),
  pinnedOrder: z.array(z.string()),
  migratedHosts: z.array(z.string()),
  legacyPinRanks: z
    .record(z.string(), z.object({ workspaceRank: z.number(), createdAt: z.number() }))
    .optional(),
  pinOrderEdited: z.boolean().optional(),
  selectedSessionKey: z.string().nullable().optional(),
  selectedDirectoryBySession: z.record(z.string(), z.string()).optional(),
});
interface SessionNavigationPreferences extends z.infer<typeof PreferencesSchema> {
  search: string;
  selectSession(key: string): void;
  selectDirectory(sessionKey: string, path: string): void;
  setSearch(search: string): void;
  toggleExpanded(key: string): void;
  setPinnedOrder(order: string[]): void;
  migratePins(serverId: string, keys: LegacySessionPin[]): void;
}
export const useSessionNavigationPreferences = create<SessionNavigationPreferences>()(
  persist(
    (set) => ({
      expanded: {},
      pinnedOrder: [],
      migratedHosts: [],
      legacyPinRanks: {},
      pinOrderEdited: false,
      selectedDirectoryBySession: {},
      search: "",
      selectedSessionKey: null,
      selectSession: (selectedSessionKey) => set({ selectedSessionKey }),
      selectDirectory: (sessionKey, path) =>
        set((state) => ({
          selectedSessionKey: sessionKey,
          selectedDirectoryBySession: { ...state.selectedDirectoryBySession, [sessionKey]: path },
        })),
      setSearch: (search) => set({ search }),
      toggleExpanded: (key) =>
        set((state) => ({ expanded: { ...state.expanded, [key]: !state.expanded[key] } })),
      setPinnedOrder: (pinnedOrder) => set({ pinnedOrder, pinOrderEdited: true }),
      migratePins: (serverId, keys) =>
        set((state) => {
          if (state.migratedHosts.includes(serverId)) return state;
          const merged = mergeLegacySessionPins({
            order: state.pinnedOrder,
            ranks: state.legacyPinRanks ?? {},
            entries: keys,
            edited: state.pinOrderEdited === true,
          });
          return {
            pinnedOrder: merged.order,
            legacyPinRanks: merged.ranks,
            migratedHosts: [...state.migratedHosts, serverId],
          };
        }),
    }),
    {
      name: "session-navigation",
      storage: createValidatedPersistStorage(AsyncStorage, PreferencesSchema),
      partialize: (state) => ({
        expanded: state.expanded,
        pinnedOrder: state.pinnedOrder,
        migratedHosts: state.migratedHosts,
        legacyPinRanks: state.legacyPinRanks,
        pinOrderEdited: state.pinOrderEdited,
        selectedSessionKey: state.selectedSessionKey,
        selectedDirectoryBySession: state.selectedDirectoryBySession,
      }),
    },
  ),
);
