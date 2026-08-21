import { create } from "zustand";

import {
  beginSideChatExchange,
  failSideChatExchange,
  resolveSideChatExchange,
  type SideChatAnswerPayload,
  type SideChatExchange,
} from "./model";

interface SideChatPanelState {
  isOpen: boolean;
  exchanges: SideChatExchange[];
}

interface SideChatState {
  panels: Record<string, SideChatPanelState>;
  openPanel: (key: string) => void;
  closePanel: (key: string) => void;
  togglePanel: (key: string) => void;
  beginExchange: (key: string, input: { id: string; question: string }) => void;
  resolveExchange: (key: string, id: string, payload: SideChatAnswerPayload) => void;
  failExchange: (key: string, id: string, error: string) => void;
}

const EMPTY_PANEL: SideChatPanelState = { isOpen: false, exchanges: [] };

export function selectSideChatPanel(
  state: Pick<SideChatState, "panels">,
  key: string,
): SideChatPanelState {
  return state.panels[key] ?? EMPTY_PANEL;
}

function updatePanel(
  panels: Record<string, SideChatPanelState>,
  key: string,
  update: (panel: SideChatPanelState) => SideChatPanelState,
): Record<string, SideChatPanelState> {
  return { ...panels, [key]: update(panels[key] ?? EMPTY_PANEL) };
}

// Session-scoped and in-memory on purpose: like the TUI /btw history, side
// chat exchanges are ephemeral and never persisted.
export const useSideChatStore = create<SideChatState>()((set) => ({
  panels: {},
  openPanel: (key) =>
    set((state) => ({
      panels: updatePanel(state.panels, key, (panel) => ({ ...panel, isOpen: true })),
    })),
  closePanel: (key) =>
    set((state) => ({
      panels: updatePanel(state.panels, key, (panel) => ({ ...panel, isOpen: false })),
    })),
  togglePanel: (key) =>
    set((state) => ({
      panels: updatePanel(state.panels, key, (panel) => ({ ...panel, isOpen: !panel.isOpen })),
    })),
  beginExchange: (key, input) =>
    set((state) => ({
      panels: updatePanel(state.panels, key, (panel) => ({
        ...panel,
        exchanges: beginSideChatExchange(panel.exchanges, input),
      })),
    })),
  resolveExchange: (key, id, payload) =>
    set((state) => ({
      panels: updatePanel(state.panels, key, (panel) => ({
        ...panel,
        exchanges: resolveSideChatExchange(panel.exchanges, id, payload),
      })),
    })),
  failExchange: (key, id, error) =>
    set((state) => ({
      panels: updatePanel(state.panels, key, (panel) => ({
        ...panel,
        exchanges: failSideChatExchange(panel.exchanges, id, error),
      })),
    })),
}));
