import { UnistylesRuntime } from "react-native-unistyles";
import { updateDesktopWindowChrome } from "@/desktop/electron/window";
import type { DesktopWindowChromeUpdate } from "@/desktop/host";

export type DesktopThemePreference = "system" | "light" | "dark";

/** Auto follows the system; any chosen theme, built-in or plugin, pins its own scheme. */
export function resolveDesktopThemePreference(input: {
  adaptive: boolean;
  colorScheme: "light" | "dark";
}): DesktopThemePreference {
  return input.adaptive ? "system" : input.colorScheme;
}

/**
 * Tell the desktop shell which theme the user chose, after the App applied it, so macOS window
 * vibrancy follows the App instead of the system appearance. The desktop fork layer reads
 * `themePreference` from the `updateChrome` payload; other hosts ignore it.
 */
export function syncDesktopThemePreference(): void {
  const update: DesktopWindowChromeUpdate & { themePreference: DesktopThemePreference } = {
    themePreference: resolveDesktopThemePreference({
      adaptive: UnistylesRuntime.hasAdaptiveThemes,
      colorScheme: UnistylesRuntime.getTheme().colorScheme,
    }),
  };
  void updateDesktopWindowChrome(update).catch((error) => {
    console.warn("[DesktopWindow] Failed to sync the theme preference", error);
  });
}
