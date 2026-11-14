import type { BrowserWindowConstructorOptions } from "electron";

export interface MaterialWindow {
  setBackgroundColor(color: string): void;
  setVibrancy(value: "sidebar" | null): void;
  isDestroyed(): boolean;
  once(event: "closed", callback: () => void): unknown;
}
interface MaterialTheme {
  prefersReducedTransparency: boolean;
  on(event: "updated", callback: () => void): unknown;
  removeListener(event: "updated", callback: () => void): unknown;
}

/** Own the last opaque color so accessibility changes restore the current theme. */
export function createWindowMaterial(platform: string, theme: MaterialTheme) {
  const enabled = platform === "darwin";
  const backgrounds = new WeakMap<MaterialWindow, string>();
  function updateBackground(win: MaterialWindow, color: string) {
    backgrounds.set(win, color);
    win.setBackgroundColor(enabled && !theme.prefersReducedTransparency ? "#00000000" : color);
  }
  return {
    options(backgroundColor: string): BrowserWindowConstructorOptions {
      if (!enabled) return { backgroundColor };
      return {
        transparent: true,
        backgroundColor: theme.prefersReducedTransparency ? backgroundColor : "#00000000",
        vibrancy: theme.prefersReducedTransparency ? undefined : "sidebar",
        visualEffectState: "followWindow",
      };
    },
    updateBackground,
    setup(win: MaterialWindow, color: string) {
      if (!enabled) return;
      backgrounds.set(win, color);
      const update = () => {
        if (win.isDestroyed()) return;
        win.setVibrancy(theme.prefersReducedTransparency ? null : "sidebar");
        updateBackground(win, backgrounds.get(win) ?? color);
      };
      theme.on("updated", update);
      win.once("closed", () => theme.removeListener("updated", update));
    },
  };
}
