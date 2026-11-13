import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
const PreferencesSchema = z.object({
  expanded: z.record(z.string(), z.boolean()),
  pinnedOrder: z.array(z.string()),
  migratedHosts: z.array(z.string()),
  selectedDirectoryBySession: z.record(z.string(), z.string()).optional(),
});
interface SessionNavigationPreferences extends z.infer<typeof PreferencesSchema> {
  search: string;
  selectDirectory(sessionKey: string, path: string): void;
  setSearch(search: string): void;
  toggleExpanded(key: string): void;
  setPinnedOrder(order: string[]): void;
  migratePins(serverId: string, keys: string[]): void;
}
export const useSessionNavigationPreferences = create<SessionNavigationPreferences>()(
  persist(
    (set) => ({
      expanded: {},
      pinnedOrder: [],
      migratedHosts: [],
      selectedDirectoryBySession: {},
      search: "",
      selectDirectory: (sessionKey, path) =>
        set((state) => ({
          selectedDirectoryBySession: { ...state.selectedDirectoryBySession, [sessionKey]: path },
        })),
      setSearch: (search) => set({ search }),
      toggleExpanded: (key) =>
        set((state) => ({ expanded: { ...state.expanded, [key]: !state.expanded[key] } })),
      setPinnedOrder: (pinnedOrder) => set({ pinnedOrder }),
      migratePins: (serverId, keys) =>
        set((state) => {
          if (state.migratedHosts.includes(serverId)) return state;
          return {
            pinnedOrder: [
              ...state.pinnedOrder,
              ...keys.filter((key) => !state.pinnedOrder.includes(key)),
            ],
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
        selectedDirectoryBySession: state.selectedDirectoryBySession,
      }),
    },
  ),
);
