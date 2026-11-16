import type { BrowserWindowConstructorOptions } from "electron";

export interface MaterialWindow {
  setBackgroundColor(color: string): void;
  setVibrancy(value: "sidebar" | null): void;
  isDestroyed(): boolean;
  once(event: "closed", callback: () => void): unknown;
}
const THEME_SOURCES = ["system", "light", "dark"] as const;
type ThemeSource = (typeof THEME_SOURCES)[number];
interface MaterialTheme {
  prefersReducedTransparency: boolean;
  themeSource: ThemeSource;
  on(event: "updated", callback: () => void): unknown;
  removeListener(event: "updated", callback: () => void): unknown;
}

function readThemePreference(update: unknown): ThemeSource | null {
  if (!update || typeof update !== "object") return null;
  const value = (update as { themePreference?: unknown }).themePreference;
  return THEME_SOURCES.find((source) => source === value) ?? null;
}

/**
 * Own the last opaque color so accessibility changes restore the current theme.
 *
 * Window vibrancy samples the native appearance. The renderer sends the user's theme preference
 * (`themePreference` on the `updateChrome` IPC) and it becomes `nativeTheme.themeSource`, so
 * vibrancy follows the App theme. Auto maps to "system", which keeps `prefers-color-scheme` on the
 * real system appearance.
 */
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
    /** Takes the raw `updateChrome` payload; ignores it unless it carries a valid preference. */
    applyThemePreference(update: unknown) {
      const source = readThemePreference(update);
      if (!enabled || !source || theme.themeSource === source) return;
      theme.themeSource = source;
    },
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
