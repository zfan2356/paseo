import { nativeTheme, systemPreferences } from "electron";
import { createWindowMaterial } from "./material-controller.js";

// `nativeTheme.shouldUseDarkColors` follows `themeSource` once it is pinned, so read the macOS
// appearance from the user defaults instead.
const macAppearance = {
  isDark: () => systemPreferences.getUserDefault("AppleInterfaceStyle", "string") === "Dark",
  onChange: (callback: () => void) => {
    systemPreferences.subscribeNotification("AppleInterfaceThemeChangedNotification", callback);
  },
};

const material = createWindowMaterial(process.platform, nativeTheme, macAppearance);
export const materialWindowOptions = material.options;
export const updateMaterialBackground = material.updateBackground;
export const setupWindowMaterial = material.setup;
