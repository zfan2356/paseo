import type { BrowserWindowConstructorOptions } from "electron";

export interface MaterialWindow {
  setBackgroundColor(color: string): void;
  setVibrancy(value: "sidebar" | null): void;
  isDestroyed(): boolean;
  once(event: "closed", callback: () => void): unknown;
}
type ThemeSource = "system" | "light" | "dark";
interface MaterialTheme {
  prefersReducedTransparency: boolean;
  themeSource: ThemeSource;
  on(event: "updated", callback: () => void): unknown;
  removeListener(event: "updated", callback: () => void): unknown;
}
/** The macOS appearance, independent of `themeSource`. */
export interface SystemAppearance {
  isDark(): boolean;
  onChange(callback: () => void): void;
}

// Relative luminance threshold between the light and dark theme backgrounds.
const DARK_LUMINANCE = 0.4;

export function isDarkColor(color: string): boolean | null {
  const hex = /^#([0-9a-f]{6})/i.exec(color)?.[1];
  const rgb = hex
    ? [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16))
    : /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color)?.slice(1, 4).map(Number);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < DARK_LUMINANCE;
}

/**
 * Own the last opaque color so accessibility changes restore the current theme.
 *
 * Window vibrancy samples the native appearance, not the App theme. The renderer reports its
 * theme background on every theme change, so pin `themeSource` to the App's scheme while it differs
 * from the system appearance. When they match, stay on "system": the App's Auto theme reads
 * `prefers-color-scheme`, which `themeSource` would otherwise freeze.
 */
export function createWindowMaterial(
  platform: string,
  theme: MaterialTheme,
  system: SystemAppearance,
) {
  const enabled = platform === "darwin";
  const backgrounds = new WeakMap<MaterialWindow, string>();
  let appDark: boolean | null = null;
  let watchingSystem = false;

  function syncAppearance() {
    if (appDark === null) return;
    const appScheme = appDark ? "dark" : "light";
    const source: ThemeSource = appDark === system.isDark() ? "system" : appScheme;
    if (theme.themeSource !== source) theme.themeSource = source;
  }
  function updateBackground(win: MaterialWindow, color: string) {
    backgrounds.set(win, color);
    win.setBackgroundColor(enabled && !theme.prefersReducedTransparency ? "#00000000" : color);
    if (!enabled) return;
    appDark = isDarkColor(color) ?? appDark;
    syncAppearance();
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
      if (!watchingSystem) {
        watchingSystem = true;
        system.onChange(syncAppearance);
      }
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
