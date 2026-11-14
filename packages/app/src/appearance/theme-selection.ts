import { CODEX_THEME_ID } from "../../../../plugins/codex-theme/shared/palette";
import type { AppSettings } from "@/hooks/use-settings";

export function resolveThemeSelection(settings: Pick<AppSettings, "theme" | "pluginThemeId">) {
  const codex =
    settings.theme === "codex" ||
    (settings.theme === "plugin" && settings.pluginThemeId === CODEX_THEME_ID);
  if (codex) return { requestedId: CODEX_THEME_ID, fallbackPreference: "codex" as const };
  if (settings.theme === "plugin") {
    return { requestedId: settings.pluginThemeId, fallbackPreference: "auto" as const };
  }
  return { requestedId: null, fallbackPreference: settings.theme };
}
