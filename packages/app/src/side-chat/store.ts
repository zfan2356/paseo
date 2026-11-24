import { create } from "zustand";

import type { SideChatPanelState } from "./model";

interface SideChatState {
  panels: Record<string, SideChatPanelState | undefined>;
  setPanel: (key: string, panel: SideChatPanelState) => void;
  removePanel: (key: string) => void;
}

export function selectSideChatPanel(
  state: Pick<SideChatState, "panels">,
  key: string,
): SideChatPanelState | null {
  return state.panels[key] ?? null;
}

export const useSideChatStore = create<SideChatState>()((set) => ({
  panels: {},
  setPanel: (key, panel) =>
    set((state) => ({
      panels: { ...state.panels, [key]: panel },
    })),
  removePanel: (key) =>
    set((state) => {
      if (!(key in state.panels)) return state;
      const panels = { ...state.panels };
      delete panels[key];
      return { panels };
    }),
}));
